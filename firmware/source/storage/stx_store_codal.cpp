/*
 * stx_store_codal.cpp — Glue de stx_store con la flash real de la nRF52833
 * vía MicroBitFlash (que usa sd_flash_* cuando el SoftDevice está activo:
 * asíncrono en timeslots sin radio, seguro con BLE conectado).
 *
 * Región dedicada: 4 páginas de 4 KB en 0x78000-0x7BFFF (páginas 120-123 de
 * 128). Se dejan las páginas superiores libres para el KeyValueStorage de
 * CODAL y los bonds del SoftDevice. Con S113 (~112 KB) + app, el código queda
 * muy por debajo de 0x78000; el chequeo en stx_store_codal_init() lo verifica
 * en runtime contra el fin de la imagen (linker).
 */
#include "MicroBit.h"
#include "MicroBitFlash.h"
#include "stx_store.h"

extern MicroBit uBit;

#define STX_FLASH_BASE 0x78000u

extern uint32_t __etext; /* fin del código en flash (linker) */

static MicroBitFlash flash;

static uint32_t page_address(uint8_t page) {
    return STX_FLASH_BASE + (uint32_t)page * STX_STORE_PAGE_SIZE;
}

static bool f_erase(uint8_t page) {
    if (page >= STX_STORE_PAGES) {
        return false;
    }
    return flash.erase_page((uint32_t *)page_address(page)) == MICROBIT_OK;
}

static bool f_write(uint8_t page, uint16_t offset, const uint8_t *data, uint16_t len) {
    if (page >= STX_STORE_PAGES || offset + len > STX_STORE_PAGE_SIZE ||
        (offset & 3) != 0 || (len & 3) != 0) {
        return false;
    }
    uint32_t *dst = (uint32_t *)(page_address(page) + offset);
    /* MicroBitFlash escribe palabras de 32 bits; data ya viene alineada a 4 */
    return flash.flash_write(dst, (uint32_t *)data, len / 4, 0) == MICROBIT_OK;
}

static const uint8_t *f_ptr(uint8_t page) {
    return page < STX_STORE_PAGES ? (const uint8_t *)page_address(page) : 0;
}

extern "C" {
const stx_flash_ops_t stx_flash_codal = { f_erase, f_write, f_ptr };
}

/* Verifica que la región dedicada no pise el código de la aplicación.
 * Si pisa, entra en pánico con código visible (falla de build/layout). */
void stx_store_codal_init(void) {
    uint32_t code_end = (uint32_t)&__etext;
    if (code_end >= STX_FLASH_BASE) {
        microbit_panic(880);
    }
}
