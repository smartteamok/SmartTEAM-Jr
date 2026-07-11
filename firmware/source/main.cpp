/*
 * main.cpp — Firmware SmartTEAM para micro:bit V2.
 *
 * Al bootear: si hay una imagen STX1 válida en flash y el botón A NO está
 * presionado (safe mode), la carga y la ejecuta standalone. El servicio BLE
 * UART queda siempre activo para recibir programas nuevos, comandos de
 * control y el modo live del editor.
 *
 * Loop principal cooperativo: bombea BLE, tickea el protocolo (timeouts),
 * tickea la VM y corta tonos vencidos. Nunca bloquea: BLE corre en el
 * SoftDevice/fibers y la VM cede en waits.
 */
#include "MicroBit.h"
#include "vm/stx_vm.h"
#include "proto/stx_proto_engine.h"
#include "storage/stx_store.h"
#include "hal/stx_hal_codal.h"
#include "hal/stx_hal_tinybit.h"
#include "ble/stx_ble.h"

/* Perfil de placa. Por defecto Tiny:bit (el kit SmartTEAM); poner en 0 para un
 * firmware de micro:bit sola (sin motores/faros/ultrasónico). */
#ifndef STX_PROFILE_TINYBIT
#define STX_PROFILE_TINYBIT 1
#endif

#if STX_PROFILE_TINYBIT
#define STX_HAL stx_hal_tinybit
#define STX_HAL_UPDATE stx_hal_tinybit_update
#define STX_HAL_BOARD_ID STX_BOARD_TINYBIT
#else
#define STX_HAL stx_hal_codal
#define STX_HAL_UPDATE stx_hal_codal_update
#define STX_HAL_BOARD_ID STX_BOARD_BASIC
#endif

MicroBit uBit;

extern "C" const stx_flash_ops_t stx_flash_codal;
void stx_store_codal_init(void);

static stx_vm_t vm;
static stx_proto_engine_t engine;

static uint32_t now_ms(void) {
    return (uint32_t)system_timer_current_time();
}

static void read_sensors(uint8_t out[4]) {
    out[0] = (uint8_t)uBit.display.readLightLevel();
    out[1] = (uint8_t)uBit.audio.levelSPL->getValue();
    out[2] = (uint8_t)((uBit.buttonA.isPressed() ? 1 : 0) |
                       (uBit.buttonB.isPressed() ? 2 : 0));
    out[3] = (uint8_t)uBit.thermometer.getTemperature();
}

/* Puente VM → protocolo: encola las notificaciones push (MARK/DONE/FAULT) */
static void vm_notify(uint8_t evt, uint8_t arg) {
    stx_proto_notify(&engine, evt, arg);
}

int main() {
    uBit.init();
    stx_store_codal_init();

    stx_vm_init(&vm, &STX_HAL);
    stx_proto_init(&engine, &vm, &stx_flash_codal, 0, now_ms);
    engine.read_sensors = read_sensors;
    engine.board_id = STX_HAL_BOARD_ID;
    vm.notify = vm_notify;
    stx_ble_init(&engine);

    /* Boot: cargar y autorun salvo safe mode (botón A al encender) */
    bool safe_mode = uBit.buttonA.isPressed();
    uint16_t image_len = 0;
    const uint8_t *image = stx_store_load(&stx_flash_codal, &image_len, 0);
    if (image != 0 && stx_vm_load(&vm, image, image_len) == STX_ERR_NONE) {
        if (!safe_mode) {
            stx_vm_start(&vm);
        }
    }
    if (safe_mode) {
        uBit.display.print("-");
    }

    while (true) {
        stx_ble_pump();
        stx_proto_tick(&engine);
        stx_vm_tick(&vm);
        STX_HAL_UPDATE();
        uBit.sleep(5);
    }
}
