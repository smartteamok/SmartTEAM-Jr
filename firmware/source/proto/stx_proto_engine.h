/*
 * stx_proto_engine.h — Máquina de estados del protocolo BLE (stx_proto.h).
 * C portable: recibe paquetes crudos (una escritura BLE = un paquete) y emite
 * respuestas por callback. El glue con MicroBitUARTService está en
 * ble/stx_ble.cpp; los tests de host en tests/host/test_proto.c.
 */
#ifndef STX_PROTO_ENGINE_H
#define STX_PROTO_ENGINE_H

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

    /* Sesión de transferencia en curso */
    bool session_active;
    uint16_t expected_len;
    uint32_t expected_crc;
    uint16_t received;
    uint8_t next_seq;
    uint32_t last_rx_ms;
    uint8_t buffer[STX_MAX_IMAGE_SIZE];
} stx_proto_engine_t;

void stx_proto_init(stx_proto_engine_t *pe, stx_vm_t *vm,
                    const stx_flash_ops_t *flash,
                    void (*send)(const uint8_t *, uint8_t),
                    uint32_t (*now_ms)(void));

/* Procesa un paquete entrante completo */
void stx_proto_on_packet(stx_proto_engine_t *pe, const uint8_t *data, uint8_t len);

/* Llamar periódicamente: aborta la sesión de transferencia por timeout */
void stx_proto_tick(stx_proto_engine_t *pe);

#endif /* STX_PROTO_ENGINE_H */
