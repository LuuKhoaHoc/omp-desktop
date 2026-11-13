---
description: Split a task across named agents, with a verifier
argument-hint: "<task>"
---

Run the following task as a swarm, and act only as its coordinator: do not implement anything yourself.

Split it into pieces that do not touch the same files and start one named worker per piece with the task tool (one batch call, CamelCase names). Give each worker a brief: what it owns, what it must not touch, and what done looks like. Workers that edit at the same time must not share files. Give each its own checkout with `isolated: true` only if the task tool offers that field (it exists only when `task.isolation.enabled` is on and plan mode is off); otherwise assign disjoint files, and run workers one after another when pieces overlap.

Only after the workers' results have come back, start a worker named Verifier (never in the same batch as the workers: it would run before there is anything to check) that reads their diffs, runs the tests and reports problems to the worker that wrote the code with `write agent://<name>`. Workers message each other the same way.

If the task does not split cleanly, use fewer workers and say why. When everything is verified, report who owned what and the Verifier's verdict.

Task: $ARGUMENTS
