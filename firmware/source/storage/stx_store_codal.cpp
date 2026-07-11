/*
 * stx_store_codal.cpp — Glue de stx_store con la flash real de la nRF52833
 * vía MicroBitFlash (que usa sd_flash_* cuando el SoftDevice está activo:
 * asíncrono en timeslots sin radio, seguro con BLE conectado).
 *
 * Región dedicada: 4 páginas de 4 KB en 0x70000-0x73FFF (páginas 112-115).
 * Layout real de flash en micro:bit V2 (linker nrf52833-softdevice.ld +
 * MicroBitConfig.h): app FLASH = 0x1C000-0x77000; MICROBIT_STORAGE_PAGE
 * (KeyValueStorage de CODAL) = bootloader(0x77000) - 3 páginas = 0x74000;
 * BOOTLOADER 0x77000-0x7DFFF; SETTINGS hasta 0x80000. Nuestra región queda
 * justo debajo de la reserva de CODAL, dentro del FLASH de app; el chequeo en
 * stx_store_codal_init() verifica en runtime que el código (fin = __etext)
 * no la alcanzó.
 */
#include "MicroBit.h"
#include "MicroBitFlash.h"
#include "stx_store.h"

extern MicroBit uBit;

#define STX_FLASH_BASE 0x70000u

extern uint32_t __etext; /* fin del código en flash (linker) */

static MicroBitFlash flash;

static uint32_t page_address(uint8_t page) {
    return STX_FLASH_BASE + (uint32_t)page * STX_STORE_PAGE_SIZE;
}

static bool f_erase(uint8_t page) {
    if (page >= STX_STORE_PAGES) {
        return false;
    }
    uint32_t *addr = (uint32_t *)page_address(page);
    flash.erase_page(addr); /* API void: verificar leyendo */
    for (uint32_t i = 0; i < STX_STORE_PAGE_SIZE / 4; i++) {
        if (addr[i] != 0xFFFFFFFFu) {
            return false;
        }
    }
    return true;
}

static bool f_write(uint8_t page, uint16_t offset, const uint8_t *data, uint16_t len) {
    if (page >= STX_STORE_PAGES || offset + len > STX_STORE_PAGE_SIZE ||
        (offset & 3) != 0 || (len & 3) != 0) {
        return false;
    }
    void *dst = (void *)(page_address(page) + offset);
    /* length en bytes; data ya viene alineada a 4 (contrato de stx_store) */
    return flash.flash_write(dst, (void *)data, (int)len, 0) == MICROBIT_OK;
}

static const uint8_t *f_ptr(uint8_t page) {
    return page < STX_STORE_PAGES ? (const uint8_t *)page_address(page) : 0;
}

/* extern explícito: const en C++ tendría linkage interno y el main no la vería */
extern "C" const stx_flash_ops_t stx_flash_codal = { f_erase, f_write, f_ptr };

/* Verifica que la región dedicada no pise el código de la aplicación.
 * Si pisa, entra en pánico con código visible (falla de build/layout). */
void stx_store_codal_init(void) {
    uint32_t code_end = (uint32_t)&__etext;
    if (code_end >= STX_FLASH_BASE) {
        microbit_panic(880);
    }
}
