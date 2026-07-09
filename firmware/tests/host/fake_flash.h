/*
 * fake_flash.h — Flash simulada en RAM para tests de stx_store: semántica real
 * (erase = 0xFF, write solo baja bits) + inyección de corte de energía.
 */
#ifndef FAKE_FLASH_H
#define FAKE_FLASH_H

#include <stdint.h>
#include <stdbool.h>
#include "../../source/storage/stx_store.h"

extern const stx_flash_ops_t fake_flash_ops;
extern int fake_flash_erase_count[STX_STORE_PAGES];
/* -1 = sin corte; N = la operación de escritura/borrado número N falla y
 * a partir de ahí todas fallan (simula pérdida de energía) */
extern int fake_flash_power_cut_after;

void fake_flash_reset(void);

#endif /* FAKE_FLASH_H */
