#include "stx_store.h"
#include "../vm/stx_image.h"
#include "../proto/stx_proto.h"

static uint32_t rd_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
           ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static uint16_t rd_u16(const uint8_t *p) {
    return (uint16_t)(p[0] | (p[1] << 8));
}

/* Valida el slot de una página; devuelve true y llena len/gen si es válido */
static bool slot_valid(const stx_flash_ops_t *ops, uint8_t page,
                       uint16_t *len, uint32_t *gen) {
    const uint8_t *p = ops->page_ptr(page);
    if (p == 0 || rd_u32(p) != STX_STORE_SLOT_MAGIC) {
        return false;
    }
    uint16_t image_len = rd_u16(p + 8);
    if (image_len == 0 || image_len > STX_MAX_IMAGE_SIZE ||
        image_len > STX_STORE_PAGE_SIZE - STX_STORE_HEADER_SIZE) {
        return false;
    }
    stx_image_t img;
    if (stx_image_parse(p + STX_STORE_HEADER_SIZE, image_len, &img) != STX_ERR_NONE) {
        return false;
    }
    *len = image_len;
    *gen = rd_u32(p + 4);
    return true;
}

/* Encuentra el slot vigente: generación válida más alta. Devuelve página o -1 */
static int find_current(const stx_flash_ops_t *ops,
                        uint16_t *out_len, uint32_t *out_gen) {
    int best = -1;
    uint32_t best_gen = 0;
    uint16_t best_len = 0;
    for (uint8_t page = 0; page < STX_STORE_PAGES; page++) {
        uint16_t len;
        uint32_t gen;
        if (slot_valid(ops, page, &len, &gen) && gen > best_gen) {
            best = page;
            best_gen = gen;
            best_len = len;
        }
    }
    if (best >= 0) {
        if (out_len != 0) *out_len = best_len;
        if (out_gen != 0) *out_gen = best_gen;
    }
    return best;
}

uint8_t stx_store_save(const stx_flash_ops_t *ops, const uint8_t *image, uint16_t len) {
    if (len == 0 || len > STX_MAX_IMAGE_SIZE ||
        len > STX_STORE_PAGE_SIZE - STX_STORE_HEADER_SIZE) {
        return STX_STATUS_TOO_LARGE;
    }
    uint32_t current_gen = 0;
    int current = find_current(ops, 0, &current_gen);
    uint8_t target = (current < 0) ? 0 : (uint8_t)((current + 1) % STX_STORE_PAGES);
    uint32_t new_gen = current_gen + 1;

    if (!ops->erase_page(target)) {
        return STX_STATUS_FLASH_ERROR;
    }

    /* imagen primero, padding a múltiplo de 4 con 0xFF */
    uint16_t padded = (uint16_t)((len + 3u) & ~3u);
    uint8_t tail[4] = { 0xFF, 0xFF, 0xFF, 0xFF };
    uint16_t whole = (uint16_t)(len & ~3u);
    if (whole > 0 && !ops->write(target, STX_STORE_HEADER_SIZE, image, whole)) {
        return STX_STATUS_FLASH_ERROR;
    }
    if (padded != whole) {
        for (uint16_t i = 0; i < (len - whole); i++) {
            tail[i] = image[whole + i];
        }
        if (!ops->write(target, STX_STORE_HEADER_SIZE + whole, tail, 4)) {
            return STX_STATUS_FLASH_ERROR;
        }
    }

    /* generation + imageLen (offsets 4..11) */
    uint8_t meta[8];
    meta[0] = new_gen & 0xFF;
    meta[1] = (new_gen >> 8) & 0xFF;
    meta[2] = (new_gen >> 16) & 0xFF;
    meta[3] = (new_gen >> 24) & 0xFF;
    meta[4] = len & 0xFF;
    meta[5] = (len >> 8) & 0xFF;
    meta[6] = 0xFF;
    meta[7] = 0xFF;
    if (!ops->write(target, 4, meta, 8)) {
        return STX_STATUS_FLASH_ERROR;
    }

    /* commit marker al final: el magic valida el slot */
    uint8_t magic[4] = {
        STX_STORE_SLOT_MAGIC & 0xFF,
        (STX_STORE_SLOT_MAGIC >> 8) & 0xFF,
        (STX_STORE_SLOT_MAGIC >> 16) & 0xFF,
        (STX_STORE_SLOT_MAGIC >> 24) & 0xFF
    };
    if (!ops->write(target, 0, magic, 4)) {
        return STX_STATUS_FLASH_ERROR;
    }
    return STX_STATUS_OK;
}

const uint8_t *stx_store_load(const stx_flash_ops_t *ops,
                              uint16_t *out_len, uint32_t *out_generation) {
    uint16_t len = 0;
    uint32_t gen = 0;
    int page = find_current(ops, &len, &gen);
    if (page < 0) {
        return 0;
    }
    if (out_len != 0) *out_len = len;
    if (out_generation != 0) *out_generation = gen;
    return ops->page_ptr((uint8_t)page) + STX_STORE_HEADER_SIZE;
}

uint8_t stx_store_erase_all(const stx_flash_ops_t *ops) {
    for (uint8_t page = 0; page < STX_STORE_PAGES; page++) {
        if (!ops->erase_page(page)) {
            return STX_STATUS_FLASH_ERROR;
        }
    }
    return STX_STATUS_OK;
}
