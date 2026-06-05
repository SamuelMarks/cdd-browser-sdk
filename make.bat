@echo off
setlocal

set TARGET=%1
if "%TARGET%"=="" set TARGET=help

if "%DOCS_DIR%"=="" set DOCS_DIR=docs
if "%BIN_DIR%"=="" set BIN_DIR=bin

if /I "%TARGET%"=="help" goto help
if /I "%TARGET%"=="all" goto help
if /I "%TARGET%"=="install_base" goto install_base
if /I "%TARGET%"=="install_deps" goto install_deps
if /I "%TARGET%"=="docs" goto docs
if /I "%TARGET%"=="build_docs" goto build_docs
if /I "%TARGET%"=="build" goto build
if /I "%TARGET%"=="test" goto test
if /I "%TARGET%"=="run" goto run
if /I "%TARGET%"=="build_docker" goto build_docker
if /I "%TARGET%"=="run_docker" goto run_docker

:help
echo Available commands:
echo   install_base   - Install language runtime (Rust, Node.js, etc.)
echo   install_deps   - Install local dependencies (cargo build, npm install)
echo   docs           - Generate API docs and symlink to ./docs/html
echo   build_docs     - Build the API docs and put them in the specified directory
echo   build          - Build the cdd-ctl backend and package all cdd-* WASM projects
echo   test           - Run tests locally
echo   run            - Run the API server and the Angular frontend (ng serve)
echo   build_docker   - Build alpine and debian Docker images
echo   run_docker     - Run the docker image, test the API, and stop
goto end

:install_base
echo Installing base tools on Windows...
echo Download Rust from https://rustup.rs/
echo Download Node.js from https://nodejs.org/
goto end

:install_deps
echo Installing local dependencies...
cargo fetch
goto end

:docs
echo Generating API docs...
cargo doc --no-deps
if not exist docs mkdir docs
if exist docs\html rmdir /s /q docs\html 2>nul
mklink /J docs\html target\doc
echo ^<meta http-equiv="refresh" content="0; url=cdd_ctl/index.html"^> > target\doc\index.html
goto end

:build_docs
echo Building API docs into %DOCS_DIR%...
mkdir %DOCS_DIR% 2>nul
cargo doc --no-deps --target-dir %DOCS_DIR%
goto end

:build
echo Building cdd-ctl Rust server...
cargo build --release
mkdir %BIN_DIR% 2>nul
copy targetelease\cdd-ctl.exe %BIN_DIR%
call scripts\fetch_wasm.bat
	echo Mocking build of Angular website and WASM integration of cdd-* projects...
goto end

:test
echo Running tests...
cargo test
goto end

:run
echo Starting cdd-ctl and running ng serve...
start /b cargo run
echo Running ng serve for frontend...
timeout /t 5
taskkill /IM cdd-ctl.exe /F
goto end

:build_docker
docker build -t cdd-ctl:alpine -f alpine.Dockerfile .
docker build -t cdd-ctl:debian -f debian.Dockerfile .
goto end

:run_docker
docker run -d --name cdd-ctl-test -p 8080:8080 cdd-ctl:alpine
echo Waiting for server to start...
timeout /t 5
curl -s http://localhost:8080/version
docker stop cdd-ctl-test
docker rm cdd-ctl-test
docker rmi cdd-ctl:alpine cdd-ctl:debian
goto end

:end
endlocal
