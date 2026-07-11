# Tests de host de la VM STX — gcc nativo, sin CODAL.
#   make test
CC ?= cc
CFLAGS = -std=c11 -Wall -Wextra -Werror -g -I../../source

SRC_VM = ../../source/vm/stx_vm.c ../../source/vm/stx_image.c
SRC_STORE = ../../source/storage/stx_store.c
SRC_PROTO = ../../source/proto/stx_proto_engine.c

build:
	mkdir -p build

build/test_vm: build test_vm.c fake_hal.c $(SRC_VM)
	$(CC) $(CFLAGS) -o $@ test_vm.c fake_hal.c $(SRC_VM)

build/test_store: build test_store.c fake_flash.c $(SRC_STORE) ../../source/vm/stx_image.c
	$(CC) $(CFLAGS) -o $@ test_store.c fake_flash.c $(SRC_STORE) ../../source/vm/stx_image.c

build/test_proto: build test_proto.c fake_hal.c fake_flash.c $(SRC_VM) $(SRC_STORE) $(SRC_PROTO)
	$(CC) $(CFLAGS) -o $@ test_proto.c fake_hal.c fake_flash.c $(SRC_VM) $(SRC_STORE) $(SRC_PROTO)

test: build/test_vm build/test_store build/test_proto
	./build/test_vm
	./build/test_store
	./build/test_proto

clean:
	rm -rf build

.PHONY: test clean
