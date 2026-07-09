/*
 * stx_image.h — Validación y acceso a imágenes STX1. C portable, sin CODAL.
 */
#ifndef STX_IMAGE_H
#define STX_IMAGE_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdbool.h>
#include "stx_isa.h"

typedef struct stx_event_entry {
    uint8_t type;      /* STX_EVT_* */
    uint8_t param;
    uint16_t offset;   /* relativo al inicio de la sección de código */
} stx_event_entry_t;

/* Vista sobre un buffer de imagen ya validado (no copia datos) */
typedef struct stx_image {
    const uint8_t *buf;
    uint16_t total_len;
    uint8_t event_count;
    const uint8_t *code;   /* inicio de la sección de código */
    uint16_t code_len;
} stx_image_t;

/*
 * Valida el buffer (magic, versión, longitudes, offsets de eventos, CRC32) y
 * llena la vista. Devuelve STX_ERR_NONE o STX_ERR_BAD_IMAGE.
 */
uint8_t stx_image_parse(const uint8_t *buf, uint16_t len, stx_image_t *out);

/* Lee la entrada i de la tabla de eventos (i < event_count) */
void stx_image_event(const stx_image_t *img, uint8_t i, stx_event_entry_t *out);

/* CRC-32/IEEE (igual que zlib y que BytecodeAssembler.crc32) */
uint32_t stx_crc32(const uint8_t *data, uint32_t len);


#ifdef __cplusplus
}
#endif

#endif /* STX_IMAGE_H */
