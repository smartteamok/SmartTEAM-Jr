/*
 * stx_ble.h — Puente MicroBitUARTService ↔ stx_proto_engine.
 */
#ifndef STX_BLE_H
#define STX_BLE_H

#include "../proto/stx_proto_engine.h"

/* Crea el servicio UART y lo asocia al engine. Llamar tras uBit.init(). */
void stx_ble_init(stx_proto_engine_t *engine);

/* Bombea bytes recibidos hacia el engine. Llamar desde el loop principal. */
void stx_ble_pump(void);

#endif /* STX_BLE_H */
