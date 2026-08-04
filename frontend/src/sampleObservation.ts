const headers = `id.orig_p,id.resp_p,proto,service,flow_duration,fwd_pkts_tot,bwd_pkts_tot,fwd_data_pkts_tot,bwd_data_pkts_tot,fwd_pkts_per_sec,bwd_pkts_per_sec,flow_pkts_per_sec,down_up_ratio,fwd_header_size_tot,fwd_header_size_min,fwd_header_size_max,bwd_header_size_tot,bwd_header_size_min,bwd_header_size_max,flow_FIN_flag_count,flow_SYN_flag_count,flow_RST_flag_count,fwd_PSH_flag_count,bwd_PSH_flag_count,flow_ACK_flag_count,fwd_URG_flag_count,bwd_URG_flag_count,flow_CWR_flag_count,flow_ECE_flag_count,fwd_pkts_payload.min,fwd_pkts_payload.max,fwd_pkts_payload.tot,fwd_pkts_payload.avg,fwd_pkts_payload.std,bwd_pkts_payload.min,bwd_pkts_payload.max,bwd_pkts_payload.tot,bwd_pkts_payload.avg,bwd_pkts_payload.std,flow_pkts_payload.min,flow_pkts_payload.max,flow_pkts_payload.tot,flow_pkts_payload.avg,flow_pkts_payload.std,fwd_iat.min,fwd_iat.max,fwd_iat.tot,fwd_iat.avg,fwd_iat.std,bwd_iat.min,bwd_iat.max,bwd_iat.tot,bwd_iat.avg,bwd_iat.std,flow_iat.min,flow_iat.max,flow_iat.tot,flow_iat.avg,flow_iat.std,payload_bytes_per_second,fwd_subflow_pkts,bwd_subflow_pkts,fwd_subflow_bytes,bwd_subflow_bytes,fwd_bulk_bytes,bwd_bulk_bytes,fwd_bulk_packets,bwd_bulk_packets,fwd_bulk_rate,bwd_bulk_rate,active.min,active.max,active.tot,active.avg,active.std,idle.min,idle.max,idle.tot,idle.avg,idle.std,fwd_init_window_size,bwd_init_window_size,fwd_last_window_size,Attack_type`;

const normalValues = `38667,1883,tcp,mqtt,32.011598,9,5,3,3,0.281148,0.156193,0.437341,0.555556,296,32,40,168,32,40,0,2,1,3,3,13,0,0,0,0,0.0,33.0,76.0,8.444444,13.115935999999998,0.0,23.0,32.0,6.4,9.555103,0.0,33.0,108.0,7.714286,11.618477,761.985779,29729182.958603,32011597.87178,4001449.733973,10403073.630178,4438.877106,1511693.954468,2026391.0293580003,506597.75733900006,680406.147126,761.985779,29729182.958603,32011597.87178,2462430.605522,8199746.707142998,3.373777,3.0,1.666667,25.333333,10.666667,0.0,0.0,0.0,0.0,0.0,0.0,2282414.913177,2282414.913177,2282414.913177,2282414.913177,0.0,29729182.958603,29729182.958603,29729182.958603,29729182.958603,0.0,64240,26847,502,MQTT_Publish`;
const attackValues = `5353,5353,udp,dns,0.0,1,0,1,0,0.0,0.0,0.0,0.0,8,8,8,0,0,0,0,0,0,0,0,0,0,0,0,0,118.0,118.0,118.0,118.0,0.0,0.0,0.0,0.0,0.0,0.0,118.0,118.0,118.0,118.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.0,118.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0,0,0,ARP_poisioning`;

export const datasetExampleProvenance = {
  dataset: "RT-IoT2022",
  extractedSha256: "956956c09c1764584fa08acd0f6876475626bcedcd6a6b1f8c492c2e9a2089ea",
  normal: { sourceLine: 2, label: "MQTT_Publish", expectedBinary: "normal" },
  attack: { sourceLine: 12509, label: "ARP_poisioning", expectedBinary: "attack" },
} as const;

export const verifiedNormalObservationCsv = `${headers}\n${normalValues}`;
export const verifiedAttackObservationCsv = `${headers}\n${attackValues}`;

/** Backward-compatible alias for tests and imports that only need a valid row. */
export const savedObservationCsv = verifiedNormalObservationCsv;
