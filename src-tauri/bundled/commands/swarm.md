---
description: Split a task across named agents, with a verifier
argument-hint: "<task>"
---

Run the task below as a swarm. You are its coordinator: you split the work, brief the workers, pass on what the user says and report. Every file change belongs to a worker; you change no file yourself, neither in the project nor in omp's configuration.

Before the first worker: the task is the text after `Task:`. When it is empty, say in one line which task from this conversation you take it to be and wait for the user to confirm it. Ask every question a brief depends on now, and start workers once the answers are in.

Workers: split the task into pieces that touch different files and start one named worker per piece with the task tool: at least two, in one batch call, with CamelCase names, all in this checkout. Work that cannot be separated by file is one piece and goes to one worker. A task that is one piece gets one worker, and you say why before you start it. Each brief says which files the worker owns, what it must leave alone and what done looks like. Set `isolated: true` only when the user asks for separate checkouts: omp may then keep a worker's changes as a patch or a branch instead of applying them, so note the location its result names.

Verifier: the same batch call starts one more worker, named Verifier. Its brief carries the task and every worker's name and files, and its first run is preparation only: it finds the tests and checks that cover those files, lists what it will check, changes nothing and finishes. It then waits for your message.

While they run: a worker runs until it finishes or the user tells you to stop it. A new answer from the user, a wider scope or a correction goes to the worker with `write agent://<name>`; workers message each other the same way. Workers use the model omp is configured with. Pass a model for a worker only when the user named one, and when omp refuses it, report that and wait for the user.

When the workers' results have come back, wake the Verifier with `write agent://Verifier`: name each worker that finished and where its changes are (this checkout, or the patch or branch of an isolated worker). The Verifier reads those changes, runs the tests and reports problems to the worker that wrote the code with `write agent://<name>`; its verdict comes back to you as its result.

When everything is verified, report who owned what, the Verifier's verdict and any change that is still a patch or a branch.

Task: $ARGUMENTS
