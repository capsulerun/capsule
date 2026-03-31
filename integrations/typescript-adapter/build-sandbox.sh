capsule build src/python_sandbox/index.py --export
mv src/python_sandbox/index.wasm sandboxes/python_sandbox.wasm
capsule build src/js_sandbox/index.ts --export
mv src/js_sandbox/index.wasm sandboxes/js_sandbox.wasm
