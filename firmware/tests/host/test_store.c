/*
 * test_store.c — Tests del wear-leveling de stx_store con flash simulada,
 * incluyendo cortes de energía a mitad de escritura.
 */
#include <stdio.h>
#include <string.h>
#include "../../source/storage/stx_store.h"
#include "../../source/proto/stx_proto.h"
#include "fake_flash.h"
#include "test_util.h"

static int failures = 0;
static int checks = 0;

#define CHECK(cond) do { \
    checks++; \
    if (!(cond)) { \
        failures++; \
        printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond); \
    } \
} while (0)

/* imagen válida con un byte variable para distinguir versiones */
static uint16_t make_image(uint8_t *buf, uint8_t marker) {
    const uint8_t code[] = { STX_OP_LED_BRIGHT, marker, STX_OP_HALT };
    return tu_build_start_image(buf, code, sizeof(code));
}

static void test_empty_load(void) {
    fake_flash_reset();
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) == 0);
}

static void test_save_load_roundtrip(void) {
    fake_flash_reset();
    uint8_t image[64];
    uint16_t len = make_image(image, 1);

    CHECK(stx_store_save(&fake_flash_ops, image, len) == STX_STATUS_OK);
    uint16_t got_len = 0;
    uint32_t gen = 0;
    const uint8_t *loaded = stx_store_load(&fake_flash_ops, &got_len, &gen);
    CHECK(loaded != 0);
    CHECK(got_len == len);
    CHECK(gen == 1);
    CHECK(memcmp(loaded, image, len) == 0);
}

static void test_rotation_and_generation(void) {
    fake_flash_reset();
    uint8_t image[64];
    /* 9 guardados: deben rotar por las 4 páginas (0,1,2,3,0,1,2,3,0) */
    for (uint8_t i = 1; i <= 9; i++) {
        uint16_t len = make_image(image, i);
        CHECK(stx_store_save(&fake_flash_ops, image, len) == STX_STATUS_OK);
    }
    uint32_t gen = 0;
    uint16_t len = 0;
    const uint8_t *loaded = stx_store_load(&fake_flash_ops, &len, &gen);
    CHECK(loaded != 0);
    CHECK(gen == 9);
    /* la última versión es la del marker 9 (LED_BRIGHT arg en el código) */
    stx_image_t img;
    CHECK(stx_image_parse(loaded, len, &img) == STX_ERR_NONE);
    CHECK(img.code[1] == 9);
    /* wear-leveling real: los borrados se repartieron entre las 4 páginas */
    CHECK(fake_flash_erase_count[0] == 3);  /* guardados 1, 5, 9 */
    CHECK(fake_flash_erase_count[1] == 2);
    CHECK(fake_flash_erase_count[2] == 2);
    CHECK(fake_flash_erase_count[3] == 2);
}

static void test_power_cut_preserves_previous(void) {
    fake_flash_reset();
    uint8_t image[64];
    uint16_t len = make_image(image, 1);
    CHECK(stx_store_save(&fake_flash_ops, image, len) == STX_STATUS_OK);

    /* segundo guardado con corte en cada punto posible de la secuencia */
    for (int cut = 1; cut <= 4; cut++) {
        fake_flash_power_cut_after = -1;
        /* medir cuántas operaciones usa un guardado completo */
        uint8_t tmp[64];
        uint16_t len2 = make_image(tmp, 2);

        /* reconstruir el estado base: v1 vigente */
        fake_flash_reset();
        stx_store_save(&fake_flash_ops, image, len);

        fake_flash_power_cut_after = cut;
        uint8_t status = stx_store_save(&fake_flash_ops, tmp, len2);
        fake_flash_power_cut_after = -1;

        uint16_t got_len = 0;
        uint32_t gen = 0;
        const uint8_t *loaded = stx_store_load(&fake_flash_ops, &got_len, &gen);
        if (status == STX_STATUS_OK) {
            /* el corte cayó después del commit: v2 vigente */
            CHECK(loaded != 0 && gen == 2);
        } else {
            /* corte a mitad: la v1 sigue intacta y vigente */
            CHECK(loaded != 0);
            CHECK(gen == 1);
            CHECK(memcmp(loaded, image, len) == 0);
        }
    }
}

static void test_erase_all(void) {
    fake_flash_reset();
    uint8_t image[64];
    uint16_t len = make_image(image, 1);
    stx_store_save(&fake_flash_ops, image, len);
    CHECK(stx_store_erase_all(&fake_flash_ops) == STX_STATUS_OK);
    CHECK(stx_store_load(&fake_flash_ops, 0, 0) == 0);
}

static void test_corrupt_slot_ignored(void) {
    fake_flash_reset();
    uint8_t image[64];
    uint16_t len = make_image(image, 1);
    stx_store_save(&fake_flash_ops, image, len);
    uint16_t len2 = make_image(image, 2);
    stx_store_save(&fake_flash_ops, image, len2);
    /* corromper el slot más nuevo (página 1) a nivel imagen */
    uint8_t bad[4] = { 0x00, 0x00, 0x00, 0x00 };
    fake_flash_ops.write(1, STX_STORE_HEADER_SIZE + 16, bad, 4);
    uint32_t gen = 0;
    const uint8_t *loaded = stx_store_load(&fake_flash_ops, 0, &gen);
    CHECK(loaded != 0);
    CHECK(gen == 1); /* volvió a la versión anterior válida */
}

int main(void) {
    test_empty_load();
    test_save_load_roundtrip();
    test_rotation_and_generation();
    test_power_cut_preserves_previous();
    test_erase_all();
    test_corrupt_slot_ignored();
    printf("%d checks, %d failures\n", checks, failures);
    return failures == 0 ? 0 : 1;
}
