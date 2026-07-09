/*
 * stx_ble.cpp — Puente entre MicroBitUARTService (Nordic UART) y el engine del
 * protocolo. El servicio entrega un stream de bytes; stx_proto_on_bytes se
 * encarga del framing. Las respuestas salen por TX notify.
 */
#include "MicroBit.h"
#include "MicroBitUARTService.h"
#include "stx_ble.h"

extern MicroBit uBit;

static MicroBitUARTService *uart = 0;
static stx_proto_engine_t *proto_engine = 0;

/* callback de envío para el engine */
static void ble_send(const uint8_t *data, uint8_t len) {
    if (uart != 0) {
        uart->send(data, len);
    }
}

void stx_ble_init(stx_proto_engine_t *engine) {
    proto_engine = engine;
    engine->send = ble_send;
    /* buffers generosos: la transferencia manda ráfagas de ~19 B */
    uart = new MicroBitUARTService(*uBit.ble, 240, 32);
}

void stx_ble_pump(void) {
    if (uart == 0 || proto_engine == 0) {
        return;
    }
    uint8_t buf[32];
    int n = uart->read(buf, sizeof(buf), ASYNC);
    if (n > 0) {
        stx_proto_on_bytes(proto_engine, buf, (uint16_t)n);
    }
}
