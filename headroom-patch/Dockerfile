FROM ghcr.io/chopratejas/headroom:latest
# Host CPU (Xeon E5-2630 v1, Sandy Bridge) lacks AVX2.
# onnxruntime wheels >=1.17 require AVX2 baseline -> SIGILL (exit 132) under load.
# magika (ML content-type detector) is the only consumer of onnxruntime in headroom;
# headroom.compression.detector.get_detector() falls back to a non-ML FallbackDetector
# automatically when magika is not importable. Remove it to eliminate the crash loop.
RUN pip uninstall -y magika onnxruntime || true
