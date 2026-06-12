# Aragorn — phase gates (BUILD_SPEC §8). Never start dependent work on a red gate.

SHELL := /bin/bash

.PHONY: p0 p1 p2 p3 p4 p5 demo demo-reset

p0:
	./scripts/gates/p0.sh

p1:
	./scripts/gates/p1.sh

p2:
	./scripts/gates/p2.sh

p3:
	./scripts/gates/p3.sh

p4:
	./scripts/gates/p4.sh

p5:
	./scripts/gates/p5.sh

demo:
	./scripts/gates/demo.sh

demo-reset:
	./scripts/demo-reset.sh
