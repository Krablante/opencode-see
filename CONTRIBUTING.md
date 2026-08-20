# Contributing

Say what changed and why. A reviewer should not have to reverse-engineer the
reason from a polished wall of generated text.

For a bug fix:

1. reproduce the behavior with the smallest useful case;
2. change the smallest compatible surface;
3. add or adjust a central test that proves the contract;
4. run `npm run check`;
5. describe the tradeoff in the pull request.

Open an issue before starting a large feature or dependency. The project stays
small on purpose: no browser framework, provider SDK, auth system, image index,
or background service unless a measured requirement makes it unavoidable.

Do not commit credentials, private paths, real operator configuration, captured
personal images, or machine topology. Demo media must be reproducible from
disposable local inputs through `npm run demos`.
