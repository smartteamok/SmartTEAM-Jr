# Tests de host de la VM STX — gcc nativo, sin CODAL.
#   make test
CC ?= cc
CFLAGS = -std=c11 -Wall -Wextra -Werror -g -I../../source

SRC_VM = ../../source/vm/stx_vm.c ../../source/vm/stx_image.c
SRC_STORE = ../../source/storage/stx_store.c
SRC_PROTO = ../../source/proto/stx_proto_engine.c

# Every binary depends on every header. Without this, editing a limit in
# stx_isa.h left stale binaries and `make test` reported a pass for code that
# was never recompiled — a false green on exactly the kind of change these
# tests exist to catch. Rebuilding all three on any header edit is cheap.
HEADERS = $(wildcard ../../source/*/*.h) $(wildcard *.h)

# Order-only: the directory's mtime must not itself trigger relinks.
build:
	mkdir -p build

build/test_vm: test_vm.c fake_hal.c $(SRC_VM) $(HEADERS) | build
	$(CC) $(CFLAGS) -o $@ test_vm.c fake_hal.c $(SRC_VM)

build/test_store: test_store.c fake_flash.c $(SRC_STORE) ../../source/vm/stx_image.c $(HEADERS) | build
	$(CC) $(CFLAGS) -o $@ test_store.c fake_flash.c $(SRC_STORE) ../../source/vm/stx_image.c

build/test_proto: test_proto.c fake_hal.c fake_flash.c $(SRC_VM) $(SRC_STORE) $(SRC_PROTO) $(HEADERS) | build
	$(CC) $(CFLAGS) -o $@ test_proto.c fake_hal.c fake_flash.c $(SRC_VM) $(SRC_STORE) $(SRC_PROTO)

test: build/test_vm build/test_store build/test_proto
	./build/test_vm
	./build/test_store
	./build/test_proto

clean:
	rm -rf build

.PHONY: test clean
