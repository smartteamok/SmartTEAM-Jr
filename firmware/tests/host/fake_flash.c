#include "fake_flash.h"
#include <string.h>

static uint8_t mem[STX_STORE_PAGES][STX_STORE_PAGE_SIZE];
int fake_flash_erase_count[STX_STORE_PAGES];
int fake_flash_power_cut_after = -1;
static int op_count = 0;

static bool power_ok(void) {
    if (fake_flash_power_cut_after < 0) {
        return true;
    }
    op_count++;
    return op_count <= fake_flash_power_cut_after;
}

void fake_flash_reset(void) {
    memset(mem, 0xFF, sizeof(mem));
    memset(fake_flash_erase_count, 0, sizeof(fake_flash_erase_count));
    fake_flash_power_cut_after = -1;
    op_count = 0;
}

static bool f_erase(uint8_t page) {
    if (page >= STX_STORE_PAGES || !power_ok()) {
        return false;
    }
    memset(mem[page], 0xFF, STX_STORE_PAGE_SIZE);
    fake_flash_erase_count[page]++;
    return true;
}

static bool f_write(uint8_t page, uint16_t offset, const uint8_t *data, uint16_t len) {
    if (page >= STX_STORE_PAGES || offset + len > STX_STORE_PAGE_SIZE ||
        (offset & 3) != 0 || (len & 3) != 0 || !power_ok()) {
        return false;
    }
    for (uint16_t i = 0; i < len; i++) {
        mem[page][offset + i] &= data[i]; /* NOR flash: solo baja bits */
    }
    return true;
}

static const uint8_t *f_ptr(uint8_t page) {
    return page < STX_STORE_PAGES ? mem[page] : 0;
}

const stx_flash_ops_t fake_flash_ops = { f_erase, f_write, f_ptr };
