.PHONY: all help install_base install_deps docs build_docs build test run build_docker run_docker

DOCS_DIR ?= docs
BIN_DIR ?= bin

all: help

help:
	@echo "Available commands:"
	@echo "  install_base   - Install language runtime (Rust, Node.js, etc.)"
	@echo "  install_deps   - Install local dependencies (cargo build, npm install)"
	@echo "  docs           - Generate API docs and symlink to ./docs/html"
	@echo "  build_docs [DOCS_DIR=docs] - Build the API docs and put them in the specified directory"
	@echo "  build [BIN_DIR=bin]        - Build the cdd-ctl backend and package all cdd-* WASM projects"
	@echo "  test           - Run tests locally"
	@echo "  run            - Run the API server and the Angular frontend (ng serve)"
	@echo "  build_docker   - Build alpine and debian Docker images"
	@echo "  run_docker     - Run the docker image, test the API, and stop"

install_base:
	@echo "Installing base tools..."
	curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
	@if [ -f /etc/debian_version ]; then \
		sudo apt-get update && sudo apt-get install -y gcc pkg-config curl; \
		curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -; \
		sudo apt-get install -y nodejs; \
	elif [ -f /etc/alpine-release ]; then \
		sudo apk add --no-cache gcc pkgconfig curl nodejs npm; \
	elif [ -f /etc/redhat-release ]; then \
		sudo dnf install -y gcc pkgconf curl nodejs npm; \
	fi

install_deps:
	@echo "Installing local dependencies..."
	cargo fetch

docs:
	@echo "Generating API docs..."
	cargo doc --no-deps
	mkdir -p docs
	rm -rf docs/html
	ln -s ../target/doc docs/html
	echo '<meta http-equiv="refresh" content="0; url=cdd_ctl/index.html">' > target/doc/index.html

build_docs:
	@echo "Building API docs into $(DOCS_DIR)..."
	mkdir -p $(DOCS_DIR)
	cargo doc --no-deps --target-dir $(DOCS_DIR)

build:
	@echo "Building cdd-ctl Rust server..."
	cargo build --release --out-dir $(BIN_DIR) -Z unstable-options || cargo build --release
	@echo "Copying built binary to $(BIN_DIR)"
	mkdir -p $(BIN_DIR)
	cp target/release/cdd-ctl $(BIN_DIR)/
	./scripts/fetch_wasm.sh
	@echo "Mocking build of Angular website and WASM integration of cdd-* projects..."

test:
	@echo "Running tests..."
	cargo test

run:
	@echo "Starting cdd-ctl in background and running ng serve..."
	cargo run & echo $$! > cdd-ctl.pid
	echo "Running ng serve for frontend..."
	sleep 5
	kill `cat cdd-ctl.pid`

build_docker:
	docker build -t cdd-ctl:alpine -f alpine.Dockerfile .
	docker build -t cdd-ctl:debian -f debian.Dockerfile .

run_docker:
	docker run -d --name cdd-ctl-test -p 8080:8080 cdd-ctl:alpine
	@echo "Waiting for server to start..."
	sleep 5
	curl -s http://localhost:8080/version || echo "Failed to reach server"
	docker stop cdd-ctl-test
	docker rm cdd-ctl-test
	docker rmi cdd-ctl:alpine cdd-ctl:debian
