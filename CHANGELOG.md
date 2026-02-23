# Changelog

## [0.3.8](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.7...tuicraft-v0.3.8) (2026-02-23)


### Features

* Add non-destructive slice method to RingBuffer ([9f9558e](https://github.com/tvararu/tuicraft/commit/9f9558e9312fc882d5630e59aea56262cd757557))
* Switch READ_WAIT to window-based slicing ([b6e1b94](https://github.com/tvararu/tuicraft/commit/b6e1b944b02167808f5bba95ba00fa730bc4ae9c))


### Documentation

* Add per-socket cursor design for tail/read conflict ([b3509a6](https://github.com/tvararu/tuicraft/commit/b3509a68bda920f6bd2b8dc6cb46d8a889510e6d))
* Revise design to hybrid approach, add implementation plan ([26f95ce](https://github.com/tvararu/tuicraft/commit/26f95ced98957709581fcda7423c5c36eb81a62c))

## [0.3.7](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.6...tuicraft-v0.3.7) (2026-02-21)


### Bug Fixes

* Parse Slash Commands In Send Mode ([241866c](https://github.com/tvararu/tuicraft/commit/241866c1f204acfd945c553e3a396db08fa20fb0))
* Preserve Slash Responses In JSON Send Mode ([cfc47ae](https://github.com/tvararu/tuicraft/commit/cfc47ae65d9a1c11657bc89cb7febc602ae74df5))


### Documentation

* Add TUI vision design document ([f991fab](https://github.com/tvararu/tuicraft/commit/f991fab42c202ae3e77293454c014548c2940d89))


### Maintenance

* Cover Slash Fallback Path In Daemon Parser ([1b98a32](https://github.com/tvararu/tuicraft/commit/1b98a329f74c6782fb4cfd20ce81eae21e704381))
* Cover Slash Parsing Branches In Daemon Commands ([f49b63d](https://github.com/tvararu/tuicraft/commit/f49b63dc918ae72f0223f28dc15ae7bed89290e4))
* Integrate Entire.io for session tracking ([029a51c](https://github.com/tvararu/tuicraft/commit/029a51c7f883d5d1d1ce78d40f2776fb36ca5102))

## [0.3.6](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.5...tuicraft-v0.3.6) (2026-02-20)


### Features

* Add comprehensive 3.3.5a opcode constants ([4d7bbfe](https://github.com/tvararu/tuicraft/commit/4d7bbfe895f6f4bf5d12e14858df3937759b569d))
* Add has() method to OpcodeDispatch ([f92d2c6](https://github.com/tvararu/tuicraft/commit/f92d2c6449e70254949346cf847d46fdda0b7902))
* Add IPC command stubs for unimplemented features ([059fc08](https://github.com/tvararu/tuicraft/commit/059fc08ffb4d807860ae10d17033a057a1873dc5))
* Add opcode stub registry ([47695d3](https://github.com/tvararu/tuicraft/commit/47695d36bc063a7b5784acdc8482d8536a66a57a))
* Add TUI command stubs for unimplemented features ([8ec6be5](https://github.com/tvararu/tuicraft/commit/8ec6be55edd39acaa3bfeba944bc99494cf17c61))
* Register opcode stubs in world session ([87b113d](https://github.com/tvararu/tuicraft/commit/87b113db40f7980500d973382f41e3f4f683cdd6))


### Bug Fixes

* Auto-launch setup wizard when running without config ([03d38bb](https://github.com/tvararu/tuicraft/commit/03d38bbcd12215fe156aaace0ede025198407b65))
* **ci:** Increase task timeout to 60s for cold-cache tsc ([7889b53](https://github.com/tvararu/tuicraft/commit/7889b53f63da1fabd2df83e029874e93256d294b))
* Defer stub notification until onMessage is attached ([ca1047f](https://github.com/tvararu/tuicraft/commit/ca1047f0cf698f901d0aebb2407549ac7e663daf))
* Mask password echo during interactive setup ([4ea9a1a](https://github.com/tvararu/tuicraft/commit/4ea9a1a35404cdd7a4be6f1e3b679ca27cb3d436))
* **site:** Improve muted text contrast to WCAG AAA ([b5447f6](https://github.com/tvararu/tuicraft/commit/b5447f6dc60cfb4c1923dffd9b4a117664b8f8a6))
* Use ~/.local/bin on Linux when /usr/local/bin is not writable ([6e21c79](https://github.com/tvararu/tuicraft/commit/6e21c794789916a94d5472f3543f59d553abee9a))


### Documentation

* Add feature coverage section to README ([75483b3](https://github.com/tvararu/tuicraft/commit/75483b3e1298eeeacb67ddc33c3d0b8d772c58e6))
* Add opcode stubs design document ([06f97da](https://github.com/tvararu/tuicraft/commit/06f97daccc50a913f13b462a0becb86ff4196f72))
* Add opcode stubs implementation plan ([f20132d](https://github.com/tvararu/tuicraft/commit/f20132de6347fc54ef3c482d69b88dabb0acff76))


### Maintenance

* Cover stub notification paths in TUI and client ([3c59099](https://github.com/tvararu/tuicraft/commit/3c59099e5bbfe1b09d1624f9d6df02394d032673))
* Remove bugs.md ([382276a](https://github.com/tvararu/tuicraft/commit/382276abba06759725753dafc162eadcefcfba96))

## [0.3.5](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.4...tuicraft-v0.3.5) (2026-02-19)


### Features

* Add --version/-v/version and -h flag shortcuts ([745a1ab](https://github.com/tvararu/tuicraft/commit/745a1ab9878e4871d0d512d8c678273bb8e6527e))
* Add authWithRetry with exponential backoff for reconnect ([3df0a26](https://github.com/tvararu/tuicraft/commit/3df0a26a588f04ac9474baf0b4aa8fa8f39b1fc8))
* Add buildReconnectProof with MD5 proof computation ([036aa4b](https://github.com/tvararu/tuicraft/commit/036aa4b8e6d06b98f69afa7e61e1136da6840a4a))
* Add parseReconnectChallengeResponse ([774c8ef](https://github.com/tvararu/tuicraft/commit/774c8efa18e644dec8a5dd81c8a9586ca2b31d21))
* Add reconnect mode to mock auth server ([e1d7344](https://github.com/tvararu/tuicraft/commit/e1d7344c1978407ab9b3c4e79aef06e3d355b532))
* Add RECONNECT_CHALLENGE and RECONNECT_PROOF auth opcodes ([d4d8e34](https://github.com/tvararu/tuicraft/commit/d4d8e3475e8600c080dc4276a49894d5a1b87bd4))
* Handle RECONNECT_CHALLENGE in auth state machine ([9583b48](https://github.com/tvararu/tuicraft/commit/9583b4889b12f5ab3590ab9209e43a309eb569c5))
* Wire callers to use authWithRetry for reconnect resilience ([f87c7c2](https://github.com/tvararu/tuicraft/commit/f87c7c2e91b2bc82b868ff7666efe3d0a7172c26))


### Bug Fixes

* **ci:** Add issues:write permission for coverage comment updates ([570bf99](https://github.com/tvararu/tuicraft/commit/570bf9981bdc458bd92c281a8c58f70254ebde56))
* **ci:** Replace REST issues API with GraphQL for coverage comments ([8da9a20](https://github.com/tvararu/tuicraft/commit/8da9a20f645a6723b576ab104cf61261f976ca74))
* Consume full 16-byte checksum salt in reconnect challenge parser ([79288a9](https://github.com/tvararu/tuicraft/commit/79288a9a0c1f25548b1d0024cc21dd2e80429240))
* Point install command at /install.sh path ([ec9f63c](https://github.com/tvararu/tuicraft/commit/ec9f63ced8236214ce18f8807ab2dd15c53a99dc))
* Replace implicit say fallback with send subcommand ([c3fbcf0](https://github.com/tvararu/tuicraft/commit/c3fbcf02c0611b4d4b9e31b2f93157088b20b042))
* Use SHA1 instead of MD5 for reconnect proof hash ([f75f178](https://github.com/tvararu/tuicraft/commit/f75f178fdefe5f1388e54e05c7cbc5bca5f3a369))


### Documentation

* Mark reconnect challenge/proof bug as resolved ([0494e55](https://github.com/tvararu/tuicraft/commit/0494e552af5b117d8b32b33aff3ee3450044adab))
* Remove resolved reconnect bug from bugs.md ([54c1556](https://github.com/tvararu/tuicraft/commit/54c15569c8e670587c83a895a96819b25803763d))
* Update README usage examples for send subcommand ([b4c76a7](https://github.com/tvararu/tuicraft/commit/b4c76a776faa29804b0ca96ec1a14cfb207c8a4c))


### Maintenance

* Cover reconnect challenge and proof failure branches ([7bfa7df](https://github.com/tvararu/tuicraft/commit/7bfa7df90ca4551800af9a15a94c683b17a8b548))
* Extract auth state machine from authHandshake ([74ac385](https://github.com/tvararu/tuicraft/commit/74ac38569165b18616be381a20baa01588e66a9e))
* Fix trailing newline in auth test file ([7095173](https://github.com/tvararu/tuicraft/commit/709517354d959860fa96c8d217c91253284ee116))
* Move --who flag to who subcommand ([e83470b](https://github.com/tvararu/tuicraft/commit/e83470b689c10a8ddb64bd742ddb1cbae5bd2bc8))

## [0.3.4](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.3...tuicraft-v0.3.4) (2026-02-19)


### Bug Fixes

* Add all 19 WoW 3.3.5a ChallengeResult auth codes ([24370e7](https://github.com/tvararu/tuicraft/commit/24370e77d54946ec8e8844a07018b031a0fefee0))
* Handle SMSG_MOTD and deliver lines as system messages ([39e8f84](https://github.com/tvararu/tuicraft/commit/39e8f84f4507db57d80bdf791bdd3f05b7803d0d))
* Inject readline factory to prevent mock leak across test files ([ab9cdc5](https://github.com/tvararu/tuicraft/commit/ab9cdc56b2391fb45f87d892dc9cec0b0173559c))
* Name 0x0D and 0x15 SMSG_AUTH_RESPONSE failure codes ([4a9fc7e](https://github.com/tvararu/tuicraft/commit/4a9fc7e7f2192aec5485d2381235cb3f254858e5))
* Skip 5 bytes for SPECIFY_BUILD version info in realm parsing ([ae2bda8](https://github.com/tvararu/tuicraft/commit/ae2bda88ab766b58087d024fe07cb0428491eb1d))


### Documentation

* Add design doc for SPECIFY_BUILD byte skip fix ([3193630](https://github.com/tvararu/tuicraft/commit/31936302508b9078f14f26cc1a66ba89fc2673a3))
* Add implementation plan for SPECIFY_BUILD byte skip fix ([8f2ae02](https://github.com/tvararu/tuicraft/commit/8f2ae020501569723cbdc3a059bbaf282bc433bf))
* Add stdlib mock leak guidance to CLAUDE.md ([5fc7a5a](https://github.com/tvararu/tuicraft/commit/5fc7a5a74e8b9bbfdf2f3256fb2c54672b90c82a))
* Remove resolved bugs from bugs.md ([9b08920](https://github.com/tvararu/tuicraft/commit/9b0892057b9d1ca3fd8964204c417243328fbfcb))


### Maintenance

* Add PR coverage reporting via lcov ([cc4d4da](https://github.com/tvararu/tuicraft/commit/cc4d4da99f2b5f38acce4a9b00f4c5c0dcf40519))
* Fix setup-lcov version tag to v1 ([b410eaf](https://github.com/tvararu/tuicraft/commit/b410eaf44d41d1d0d941f34dd0d5473bdcb7c91e))
* Install lcov for genhtml dependency ([9b82ecc](https://github.com/tvararu/tuicraft/commit/9b82ecca26b8567cb43f9c0d433aad919a5486a4))
* Pass GITHUB_TOKEN to coverage action ([c579092](https://github.com/tvararu/tuicraft/commit/c579092524e3c68ba1b7da33dd5af7d6316598cb))
* Replace lcov coverage with bun's text output ([7d8a2ca](https://github.com/tvararu/tuicraft/commit/7d8a2ca7f95577854c18547bc4caa9767a0555f3))
* Strip leading * and + before awk in tasks.main branch cleanup ([82c21ba](https://github.com/tvararu/tuicraft/commit/82c21ba3e8130a8ee88c7af781307cf6c89857d5))
* Use setup-lcov action instead of apt-get ([4bc0dca](https://github.com/tvararu/tuicraft/commit/4bc0dca6df7ae5abf4e5afc0258d63291787dbb8))

## [0.3.3](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.2...tuicraft-v0.3.3) (2026-02-19)


### Documentation

* Add commit prefix guidance to CLAUDE.md ([b947f62](https://github.com/tvararu/tuicraft/commit/b947f627087e5aa9b0008add447b8be5567f2440))
* Add install and compatibility sections ([50298f9](https://github.com/tvararu/tuicraft/commit/50298f913841fa38280f0e7a0d78c53788992553))
* Add no-hard-wrap rule for PR bodies ([86a4a80](https://github.com/tvararu/tuicraft/commit/86a4a80d8de5f5eea7ddff1de9090468c4a486de))
* Rewrite tagline and feature copy for clarity ([bb989cf](https://github.com/tvararu/tuicraft/commit/bb989cfc303772a6560b1bac31e177f30186b753))
* Update usage examples to show installed binary ([ebec193](https://github.com/tvararu/tuicraft/commit/ebec19391595c534243dcc0f7c47a3504eeb97ab))
* Use tuicraft.vararu.org install URL ([d7b8663](https://github.com/tvararu/tuicraft/commit/d7b866336d80424c1516d3dcf6d1840830ccc7a2))


### Maintenance

* Add GitHub Pages site ([e60e35b](https://github.com/tvararu/tuicraft/commit/e60e35b513c6e0be7716cf5b79cea5a4f351b2ff))
* Add install script ([9ff4d23](https://github.com/tvararu/tuicraft/commit/9ff4d234471b4008d5161ef3aca45b96a71b655e))
* Add mise deploy task and skip-if-fresh build ([98d6fe5](https://github.com/tvararu/tuicraft/commit/98d6fe5d29583a5da3b2766d5468be073ddc0379))
* Add mise main task ([99cc25f](https://github.com/tvararu/tuicraft/commit/99cc25f0d6242576a665e6fb74c73abb5758d8ba))

## [0.3.2](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.1...tuicraft-v0.3.2) (2026-02-19)


### Maintenance

* Merge release workflows and simplify CI triggers ([62a9cce](https://github.com/tvararu/tuicraft/commit/62a9ccece5d75cacfe23c667a042523b8614228f))

## [0.3.1](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.0...tuicraft-v0.3.1) (2026-02-19)


### Features

* add mise build:all for cross-compilation ([ad5bb5b](https://github.com/tvararu/tuicraft/commit/ad5bb5bb66e7fe26ee9f77be950afff8fd529bc0))


### Documentation

* add release process design doc ([7fd85cd](https://github.com/tvararu/tuicraft/commit/7fd85cd4facbc598529ab0b7a04417a69d42aa5a))
* add release process implementation plan ([f22f83e](https://github.com/tvararu/tuicraft/commit/f22f83ef49e96cec7923550bba00e36c3a6e14f9))
* Capitalize conventional commit subjects ([18d5775](https://github.com/tvararu/tuicraft/commit/18d57752bbf7f526822d50e6716e4f21136c6987))
* fill out prior art section in README ([3795f89](https://github.com/tvararu/tuicraft/commit/3795f89e0dc71a20c273bb67386ff3edc7fd5334))
* switch commit style to Conventional Commits ([2359d2d](https://github.com/tvararu/tuicraft/commit/2359d2d22bd5d4a45b156a4a582e36b8752d1771))


### Maintenance

* add release build workflow ([c84e48b](https://github.com/tvararu/tuicraft/commit/c84e48bf3036262ae4815947400d5e312f710522))
* add release-please config and manifest ([d5cffee](https://github.com/tvararu/tuicraft/commit/d5cffee2799df88e9a116e4ca46d06789d506f56))
* add release-please workflow ([bac4121](https://github.com/tvararu/tuicraft/commit/bac41217aba21dda62deb4bf159fdfebeb223a48))
* add version field to package.json ([c90d296](https://github.com/tvararu/tuicraft/commit/c90d296548de6aecc60a4ec85726c8000896d7da))
* show all commit types in changelog ([9af4e4d](https://github.com/tvararu/tuicraft/commit/9af4e4d181c3f7c4cdfbb6a6818d3c8e9fb9f76a))
* Trigger CI on pull requests ([605a534](https://github.com/tvararu/tuicraft/commit/605a53486b551a4b3a87a119e889474e80d58d0e))
