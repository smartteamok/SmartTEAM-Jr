/*
 * stx_proto_engine.h — Máquina de estados del protocolo BLE (stx_proto.h).
 * C portable: recibe paquetes crudos (una escritura BLE = un paquete) y emite
 * respuestas por callback. El glue con MicroBitUARTService está en
 * ble/stx_ble.cpp; los tests de host en tests/host/test_proto.c.
 */
#ifndef STX_PROTO_ENGINE_H
#define STX_PROTO_ENGINE_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdbool.h>
#include "stx_proto.h"
#include "../vm/stx_vm.h"
#include "../storage/stx_store.h"

typedef struct stx_proto_engine {
    stx_vm_t *vm;
    const stx_flash_ops_t *flash;
    /* Envía una respuesta por BLE TX notify (≤ STX_PKT_MAX bytes) */
    void (*send)(const uint8_t *data, uint8_t len);
    uint32_t (*now_ms)(void);
    /* Opcional (puede ser NULL): llena [luz, sonido, botones, temp] */
    void (*read_sensors)(uint8_t out[4]);
    /* Identidad de placa reportada en GET_STATUS (STX_BOARD_*) */
    uint8_t board_id;

    /* Sesión de transferencia en curso */
    bool session_active;
    bool session_volatile;      /* XFER_BEGIN con flag VOLATILE: no persistir */
    uint16_t expected_len;
    uint32_t expected_crc;
    uint16_t received;
    uint8_t next_seq;
    uint32_t last_rx_ms;
    uint8_t buffer[STX_MAX_IMAGE_SIZE];

    /* Notificaciones push pendientes (ver stx_proto_notify). El MARK colapsa
     * al más reciente con rate-limit; DONE/FAULT nunca se pierden. */
    bool has_pending_mark;
    uint8_t pending_mark;
    bool has_pending_evt;
    uint8_t pending_evt_type;   /* STX_NOTIF_DONE o STX_NOTIF_FAULT */
    uint8_t pending_evt_arg;
    uint32_t last_mark_tx_ms;

    /* Framing sobre stream (MicroBitUARTService no conserva límites de write) */
    uint8_t rx_buf[STX_PKT_MAX];
    uint8_t rx_have;
} stx_proto_engine_t;

void stx_proto_init(stx_proto_engine_t *pe, stx_vm_t *vm,
                    const stx_flash_ops_t *flash,
                    void (*send)(const uint8_t *, uint8_t),
                    uint32_t (*now_ms)(void));

/* Procesa un paquete entrante completo (ya delimitado) */
void stx_proto_on_packet(stx_proto_engine_t *pe, const uint8_t *data, uint8_t len);

/* Alimenta bytes crudos del stream UART; re-arma los paquetes y despacha.
 * Bytes con comando desconocido se descartan de a uno (re-sincronización). */
void stx_proto_on_bytes(stx_proto_engine_t *pe, const uint8_t *data, uint16_t len);

/* Llamar periódicamente: aborta la sesión de transferencia por timeout y
 * despacha las notificaciones push pendientes (nunca durante una sesión) */
void stx_proto_tick(stx_proto_engine_t *pe);

/* Puente para el hook de la VM (vm->notify): encola la notificación push.
 * vm_evt es STX_VM_EVT_* (stx_vm.h); se traduce a STX_NOTIF_*. */
void stx_proto_notify(stx_proto_engine_t *pe, uint8_t vm_evt, uint8_t arg);


#ifdef __cplusplus
}
#endif

#endif /* STX_PROTO_ENGINE_H */
