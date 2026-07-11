/*
 * stx_store.h — Almacenamiento de la imagen STX1 en flash con wear-leveling.
 * C portable: las operaciones de flash entran por punteros a función, así el
 * esquema completo (rotación, generaciones, atomicidad) se testea en host con
 * una flash simulada (tests/host/fake_flash.c). El glue real con MicroBitFlash
 * está en stx_store_codal.cpp.
 *
 * Esquema (requisito duro del proyecto: wear-leveling SIEMPRE):
 *   - STX_STORE_PAGES páginas dedicadas de STX_STORE_PAGE_SIZE bytes.
 *   - 1 slot por página: header de 16 B + imagen STX1.
 *   - Round-robin puro: se escribe en (slot_de_generación_máxima + 1) % N.
 *   - Atomicidad: erase → imagen → generation/len → magic AL FINAL (commit
 *     marker). Si se corta la energía a mitad, el slot queda inválido y el
 *     anterior sigue vigente.
 *   - Boot/carga: escanear slots, elegir la generación más alta cuya imagen
 *     valide (magic de slot + longitud sana + stx_image_parse con CRC).
 *
 * Layout del slot dentro de la página:
 *   [0..3]   slotMagic 0x53545831 ("STX1") — se escribe último
 *   [4..7]   generation u32 (arranca en 1)
 *   [8..9]   imageLen u16
 *   [10..15] reservado (0xFF)
 *   [16..]   imagen STX1
 */
#ifndef STX_STORE_H
#define STX_STORE_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdbool.h>

#define STX_STORE_PAGES 4
#define STX_STORE_PAGE_SIZE 4096
#define STX_STORE_SLOT_MAGIC 0x53545831u
#define STX_STORE_HEADER_SIZE 16

typedef struct stx_flash_ops {
    /* Borra la página (índice 0..STX_STORE_PAGES-1 dentro de la región) */
    bool (*erase_page)(uint8_t page);
    /* Escribe len bytes en page:offset (offset y len múltiplos de 4) */
    bool (*write)(uint8_t page, uint16_t offset, const uint8_t *data, uint16_t len);
    /* Puntero de solo lectura al contenido de la página */
    const uint8_t *(*page_ptr)(uint8_t page);
} stx_flash_ops_t;

/* Guarda una imagen (ya validada por el protocolo). Devuelve STX_STATUS_OK o
 * STX_STATUS_FLASH_ERROR / STX_STATUS_TOO_LARGE (stx_proto.h). */
uint8_t stx_store_save(const stx_flash_ops_t *ops, const uint8_t *image, uint16_t len);

/* Busca la imagen vigente. Devuelve puntero al inicio de la imagen dentro de
 * la flash (estable) o NULL. out_len/out_generation opcionales. */
const uint8_t *stx_store_load(const stx_flash_ops_t *ops,
                              uint16_t *out_len, uint32_t *out_generation);

/* Invalida todos los slots. Devuelve STX_STATUS_OK o STX_STATUS_FLASH_ERROR. */
uint8_t stx_store_erase_all(const stx_flash_ops_t *ops);


#ifdef __cplusplus
}
#endif

#endif /* STX_STORE_H */
