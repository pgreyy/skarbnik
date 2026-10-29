# The sealed checker and prover image for the confidential proving spike (docs/evidence/tee_spike/): Python 3.12 on
# Debian trixie (pinned by digest), two pinned Python packages, our native checker (skarbnik-check), our prover
# (skarbnik-host, with r0vm, RISC Zero 3.0.6) and the public demo program. No secret is in the image.
# Built on the project VPS from tools/tee-spike/container/ with the binaries in bin/ (their sha256 in docs/evidence/tee_spike/).
FROM python:3.12-slim-trixie@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
LABEL org.opencontainers.image.source=https://github.com/pgreyy/skarbnik
LABEL org.opencontainers.image.description="Skarbnik confidential proving spike: sealed checker and prover for a Phala Cloud TDX CVM"
LABEL org.opencontainers.image.licenses="MIT OR Apache-2.0"
COPY requirements.txt /opt/skarbnik/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /opt/skarbnik/requirements.txt
COPY bin/skarbnik-check bin/skarbnik-host bin/r0vm /opt/skarbnik/bin/
COPY demo/original.wasm demo/public_tests.txt /opt/skarbnik/demo/
COPY server.py /opt/skarbnik/server.py
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
EXPOSE 8080
CMD ["python3", "/opt/skarbnik/server.py"]
