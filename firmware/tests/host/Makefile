# Tests de host de la VM STX — gcc nativo, sin CODAL.
#   make test
CC ?= cc
CFLAGS = -std=c11 -Wall -Wextra -Werror -g -I../../source

SRC_VM = ../../source/vm/stx_vm.c ../../source/vm/stx_image.c

build:
	mkdir -p build

build/test_vm: build test_vm.c fake_hal.c $(SRC_VM)
	$(CC) $(CFLAGS) -o $@ test_vm.c fake_hal.c $(SRC_VM)

test: build/test_vm
	./build/test_vm

clean:
	rm -rf build

.PHONY: test clean
