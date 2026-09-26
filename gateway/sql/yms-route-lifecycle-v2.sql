-- YMS / BigQuery lifecycle V2 para automacao do Painel Docas AM1.
-- Objetivo: uma linha por PROCESS_ID, preservando data operacional e marcos fisicos.
-- BigQuery Standard SQL. Validar contra o ambiente real antes de integrar ao gateway.

DECLARE facility_filter STRING DEFAULT 'SSP15';
DECLARE cycle_filter STRING DEFAULT 'AM1';
DECLARE date_from DATE DEFAULT '2026-09-02';
DECLARE date_to DATE DEFAULT '2026-09-02';

WITH cycle_summary AS (
  SELECT
    CYCLE_SUMMARY_ID,
    LOGISTIC_CENTER_ID AS facility_id,
    DATE(CYCLE_SCHEDULED_TO) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(POSITION AS INT64) AS wave_number
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_SUMMARY_LM`
  WHERE LOGISTIC_CENTER_ID = facility_filter
    AND CYCLE_NAME = cycle_filter
    AND DATE(CYCLE_SCHEDULED_TO) BETWEEN date_from AND date_to
),

process_base_raw AS (
  SELECT
    cs.facility_id,
    cs.operation_date,
    cs.cycle_name,
    cs.wave_number,
    plm.PROCESS_ID AS process_id,
    plm.JOURNEY_ID AS journey_id,
    plm.CLUSTER_ROUTE_NAME AS cluster_route_name,
    CAST(plm.CARRIER_ID AS STRING) AS process_carrier_id
  FROM cycle_summary cs
  JOIN `meli-bi-data.WHOWNER.BT_LOADING_ZONES_PROCESS_LM` plm
    ON plm.CYCLE_SUMMARY_ID = cs.CYCLE_SUMMARY_ID
  WHERE plm.PROCESS_ID IS NOT NULL
),

process_base_ranked AS (
  SELECT
    pbr.*,
    COUNT(*) OVER (PARTITION BY process_id) AS process_source_row_count,
    ROW_NUMBER() OVER (
      PARTITION BY process_id
      ORDER BY operation_date DESC, wave_number ASC, journey_id DESC
    ) AS process_rank
  FROM process_base_raw pbr
),

process_base AS (
  SELECT * EXCEPT(process_rank)
  FROM process_base_ranked
  WHERE process_rank = 1
),

jp_prep AS (
  SELECT
    JOURNEY_ID AS journey_id,
    CAST(CARRIER.CARRIER_ID AS STRING) AS carrier_id,
    (
      SELECT v.VEHICLE_PLATE
      FROM UNNEST(VEHICLES) v
      WHERE SAFE_CAST(v.VEHICLE_SEQUENCE AS INT64) = 1
      LIMIT 1
    ) AS plate,
    (
      SELECT d.DRIVER_ID
      FROM UNNEST(PURPOSES) p, UNNEST(p.DRIVER) d
      WHERE p.MILE = 'last_mile'
        AND SAFE_CAST(d.DRIVER_SEQUENCE AS INT64) = 1
      LIMIT 1
    ) AS driver_id
  FROM `meli-bi-data.WHOWNER.BT_YMS_JOURNEY_PLANNER`
  WHERE JOURNEY_ID IN (
    SELECT DISTINCT journey_id
    FROM process_base
    WHERE journey_id IS NOT NULL
  )
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY JOURNEY_ID
    ORDER BY JOURNEY_ID
  ) = 1
),

process_vehicle AS (
  SELECT
    pb.*,
    jp.carrier_id AS journey_carrier_id,
    jp.plate,
    jp.driver_id
  FROM process_base pb
  LEFT JOIN jp_prep jp
    ON jp.journey_id = pb.journey_id
),

carrier_lookup AS (
  SELECT
    CAST(CARRIER_ID AS STRING) AS carrier_id,
    ARRAY_AGG(
      CARRIER_NAME IGNORE NULLS
      ORDER BY ROUTE_DATE DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS carrier_name
  FROM `meli-bi-data.WHOWNER.BT_PRECHECKIN_TRACEABILITY_LM`
  WHERE CARRIER_NAME IS NOT NULL
    AND FACILITY_ID = facility_filter
    AND DATE(ROUTE_DATE) BETWEEN date_from AND date_to
  GROUP BY CAST(CARRIER_ID AS STRING)
),

cycle_route_grouped AS (
  SELECT
    FACILITY_ID AS facility_id,
    DATE(CYCLE_DATE) AS operation_date,
    CYCLE_NAME AS cycle_name,
    SAFE_CAST(WAVE_NUMBER AS INT64) AS wave_number,
    VEHICLE_PLATE_ID AS plate,
    ARRAY_AGG(DISTINCT ROUTE_NAME IGNORE NULLS) AS route_names
  FROM `meli-bi-data.WHOWNER.BT_CYCLE_ROUTE`
  WHERE FACILITY_ID = facility_filter
    AND CYCLE_NAME = cycle_filter
    AND DATE(CYCLE_DATE) BETWEEN date_from AND date_to
    AND DOCK_USE_TYPE = 'last_mile'
  GROUP BY
    FACILITY_ID,
    DATE(CYCLE_DATE),
    CYCLE_NAME,
    SAFE_CAST(WAVE_NUMBER AS INT64),
    VEHICLE_PLATE_ID
),

cycle_route_prep AS (
  SELECT
    facility_id,
    operation_date,
    cycle_name,
    wave_number,
    plate,
    IF(ARRAY_LENGTH(route_names) = 1, route_names[SAFE_OFFSET(0)], NULL) AS route_name,
    ARRAY_LENGTH(route_names) AS route_candidate_count
  FROM cycle_route_grouped
),

plan_candidates AS (
  SELECT
    pv.process_id,
    p.ROUTE AS route_name,
    p.MODIFICATION_DATE AS modification_at,
    COUNT(*) OVER (PARTITION BY pv.process_id) AS plan_candidate_count,
    ROW_NUMBER() OVER (
      PARTITION BY pv.process_id
      ORDER BY p.MODIFICATION_DATE DESC, p.ROUTE DESC
    ) AS plan_rank
  FROM process_vehicle pv
  JOIN `meli-bi-data.WHOWNER.BT_YMS_PLANIFICATION_OPERATIVE_LM` p
    ON p.PLATE = pv.plate
   AND p.FACILITY = pv.facility_id
   AND SAFE_CAST(p.WAVE AS INT64) = pv.wave_number
   AND DATE(p.MODIFICATION_DATE)
       BETWEEN DATE_SUB(pv.operation_date, INTERVAL 1 DAY) AND pv.operation_date
  WHERE pv.plate IS NOT NULL
),

plan_prep AS (
  SELECT
    process_id,
    route_name,
    modification_at,
    plan_candidate_count
  FROM plan_candidates
  WHERE plan_rank = 1
),

event_source AS (
  SELECT
    e.*,
    DATE(e.CREATED_AT) AS event_local_date
  FROM `meli-bi-data.WHOWNER.BT_YMS_LOADING_ZONES_EVENTS` e
  WHERE e.MILE = 'last_mile'
    AND DATE(e.CREATED_AT)
        BETWEEN DATE_SUB(date_from, INTERVAL 2 DAY)
            AND DATE_ADD(date_to, INTERVAL 1 DAY)
),

event_prep AS (
  SELECT
    pb.process_id,

    MIN(CASE
      WHEN e.EVENT_NAME = 'check-in-without-prior-assignment' THEN e.CREATED_AT
      WHEN e.EVENT_NAME = 'updated'
       AND e.STATUS = 'WAITING_LOADING_ZONE'
       AND e.event_local_date = pb.operation_date THEN e.CREATED_AT
    END) AS yms_check_in_at,

    MIN(CASE
      WHEN e.STATUS = 'UN-LOAD_STARTED' THEN e.CREATED_AT
    END) AS dock_in_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'update_purpose_status'
       AND e.PURPOSE_STATUS = 'LOADING_PACKAGES_STARTED' THEN e.CREATED_AT
    END) AS loading_started_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'check-out' THEN e.CREATED_AT
    END) AS dock_out_at,

    MIN(CASE
      WHEN e.EVENT_NAME = 'gate-out' THEN e.CREATED_AT
    END) AS gate_out_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'WAITING_FOR_AUDIT' THEN e.CREATED_AT
    END) AS customs_queue_at,

    MIN(CASE
      WHEN e.PURPOSE_STATUS = 'DOING_AUDIT' THEN e.CREATED_AT
    END) AS customs_started_at,

    MAX(CASE
      WHEN e.PURPOSE_STATUS = 'DOING_AUDIT' THEN e.CREATED_AT
    END) AS customs_last_activity_at,

    ARRAY_AGG(
      e.LOADING_ZONE_NAME IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS loading_zone_name,

    ARRAY_AGG(
      e.PARKING_AREA_ID IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS parking_area_id,

    ARRAY_AGG(
      IF(
        e.CREATED_AT IS NULL,
        NULL,
        STRUCT(
          e.EVENT_NAME AS event_name,
          e.STATUS AS status,
          e.PURPOSE_STATUS AS purpose_status,
          e.CREATED_AT AS event_at
        )
      )
      IGNORE NULLS
      ORDER BY e.CREATED_AT DESC
      LIMIT 1
    )[SAFE_OFFSET(0)] AS latest_event

  FROM process_base pb
  LEFT JOIN event_source e
    ON e.PROCESS_ID = pb.process_id
  GROUP BY pb.process_id
),

parking_lookup AS (
  SELECT
    RESOURCE_ID AS parking_area_id,
    NAME AS parking_area_name
  FROM `meli-bi-data.WHOWNER.BT_SHP_MT_FACILITY_RESOURCE`
  WHERE TYPE = 'parking_area'
    AND STATUS = 'active'
    AND facility_filter IN UNNEST(SPLIT(FACILITIES, ','))
),

final_result AS (
  SELECT
    pv.facility_id,
    pv.operation_date,
    pv.cycle_name,
    pv.wave_number,

    pv.process_id,
    pv.journey_id,

    CASE
      WHEN cr.route_name IS NOT NULL AND cr.route_name != pv.cycle_name THEN cr.route_name
      WHEN plan.route_name IS NOT NULL AND plan.route_name != pv.cycle_name THEN plan.route_name
      WHEN pv.cluster_route_name IS NOT NULL AND pv.cluster_route_name != pv.cycle_name THEN pv.cluster_route_name
      ELSE NULL
    END AS route_name,

    CASE
      WHEN cr.route_name IS NOT NULL AND cr.route_name != pv.cycle_name THEN 'cycle_route'
      WHEN plan.route_name IS NOT NULL AND plan.route_name != pv.cycle_name THEN 'planification'
      WHEN pv.cluster_route_name IS NOT NULL AND pv.cluster_route_name != pv.cycle_name THEN 'loading_zones_process'
      WHEN cr.route_candidate_count > 1 THEN 'ambiguous'
      WHEN plan.plan_candidate_count > 0
        OR pv.cluster_route_name = pv.cycle_name THEN 'generic_cycle_name'
      ELSE 'unresolved'
    END AS route_source,

    CASE
      WHEN (
        (cr.route_name IS NOT NULL AND cr.route_name != pv.cycle_name)
        OR (plan.route_name IS NOT NULL AND plan.route_name != pv.cycle_name)
        OR (pv.cluster_route_name IS NOT NULL AND pv.cluster_route_name != pv.cycle_name)
      ) THEN 'resolved'
      WHEN cr.route_candidate_count > 1 THEN 'ambiguous'
      WHEN plan.plan_candidate_count > 0
        OR pv.cluster_route_name = pv.cycle_name THEN 'generic_cycle_name'
      ELSE 'unresolved'
    END AS route_resolution_status,

    cr.route_candidate_count,
    plan.plan_candidate_count,

    COALESCE(pv.journey_carrier_id, pv.process_carrier_id) AS carrier_id,
    cl.carrier_name,

    pv.plate,

    ep.loading_zone_name,
    pk.parking_area_name,

    ep.yms_check_in_at,
    ep.dock_in_at,
    ep.loading_started_at,
    ep.dock_out_at,
    ep.gate_out_at,

    ep.customs_queue_at,
    ep.customs_started_at,
    ep.customs_last_activity_at,

    ep.latest_event.event_name AS latest_event_name,
    ep.latest_event.status AS latest_status,
    ep.latest_event.purpose_status AS latest_purpose_status,
    ep.latest_event.event_at AS latest_event_at

  FROM process_vehicle pv

  LEFT JOIN cycle_route_prep cr
    ON cr.facility_id = pv.facility_id
   AND cr.operation_date = pv.operation_date
   AND cr.cycle_name = pv.cycle_name
   AND cr.wave_number = pv.wave_number
   AND cr.plate = pv.plate

  LEFT JOIN plan_prep plan
    ON plan.process_id = pv.process_id

  LEFT JOIN carrier_lookup cl
    ON cl.carrier_id = COALESCE(pv.journey_carrier_id, pv.process_carrier_id)

  LEFT JOIN event_prep ep
    ON ep.process_id = pv.process_id

  LEFT JOIN parking_lookup pk
    ON pk.parking_area_id = ep.parking_area_id
)

SELECT *
FROM final_result
ORDER BY facility_id, operation_date DESC, wave_number ASC, process_id;

-- DIAGNOSTICO DE DUPLICIDADE
-- Para validar a regra "uma linha por PROCESS_ID", substitua o SELECT final acima por:
--
-- SELECT
--   process_id,
--   COUNT(*) AS row_count
-- FROM final_result
-- GROUP BY process_id
-- HAVING COUNT(*) > 1
-- ORDER BY row_count DESC, process_id;
--
-- Validacao adicional esperada:
-- SELECT COUNT(*) AS total_rows, COUNT(DISTINCT process_id) AS distinct_processes
-- FROM final_result;
