# Changelog

## [0.4.3](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.4.2...tuicraft-v0.4.3) (2026-03-04)


### Features

* Add duel event formatters and ring buffer ([bbd3532](https://github.com/tvararu/tuicraft/commit/bbd35320cf7b51248a7fb99ea749a42d16fbecf0))
* Add duel protocol parse/build functions ([a361af8](https://github.com/tvararu/tuicraft/commit/a361af840facd5b463bd38740b84acdb2ea4bf94))
* Add DuelEvent type and context-aware accept ([e78d0bc](https://github.com/tvararu/tuicraft/commit/e78d0bc46ffd81615083cd262b908492fe7d6bdc))
* Add guild management methods to WorldHandle ([1596cc9](https://github.com/tvararu/tuicraft/commit/1596cc95f7eac3c3a517baba0257d18c539e23b3))
* Add guild management packet builders ([4eec249](https://github.com/tvararu/tuicraft/commit/4eec249ae094bd20c74f5ee54ac78cc8e70024ad))
* Add mail origin to ChatMessage type ([8418941](https://github.com/tvararu/tuicraft/commit/84189415199e504ba02a2fb089622c7b07e58c88))
* Add parseGuildEvent for SMSG_GUILD_EVENT ([2cb97c7](https://github.com/tvararu/tuicraft/commit/2cb97c7eba1d0fb9bf5895fe5206fa79e1fe2a0c))
* Expand GuildEvent union and add formatters ([5e70167](https://github.com/tvararu/tuicraft/commit/5e701678332e1d6813de49bbce34a37d1f513ec0))
* Format mail notifications as [mail] label ([3500bd9](https://github.com/tvararu/tuicraft/commit/3500bd9dd97cb6e0877a34d4359219064ce93274))
* Handle SMSG_GUILD_COMMAND_RESULT and invite ([69e1f71](https://github.com/tvararu/tuicraft/commit/69e1f716ec3674ac1b187bc9ea6780b39e19ad88))
* Handle SMSG_GUILD_EVENT opcode ([f0a5d4c](https://github.com/tvararu/tuicraft/commit/f0a5d4cccdfe14bab0d8a35f5cb8cb566f5df65b))
* Handle SMSG_RECEIVED_MAIL notification ([0f83eba](https://github.com/tvararu/tuicraft/commit/0f83ebab2d65d0f212f0d1d82a1392acdb421b08))
* Parse guild management slash commands ([9d5cb45](https://github.com/tvararu/tuicraft/commit/9d5cb45e538dede57d04956db442832c6342ecf7))
* Register duel SMSG handlers ([8a41fc9](https://github.com/tvararu/tuicraft/commit/8a41fc99d36cd7961a57aaf6a3ee348eaade7372))
* Update /mail stub to say Mail reading ([e7f73bd](https://github.com/tvararu/tuicraft/commit/e7f73bdd7e01347d17f7bcdf25f0d644932674c8))
* Wire guild management commands through IPC ([d27ceda](https://github.com/tvararu/tuicraft/commit/d27ceda6d43444d5b75b7330b495c46af7ecfe29))


### Bug Fixes

* Read SMSG_RECEIVED_MAIL field as u32 not f32 ([b2bb38f](https://github.com/tvararu/tuicraft/commit/b2bb38fb1d2fedd866c1dbff3cc353c383b955bd))
* Use human-readable guild command errors ([b4fc717](https://github.com/tvararu/tuicraft/commit/b4fc717122310d70a988c5d000db4ed00e674f87))


### Documentation

* Add duel accept/decline design ([4f37900](https://github.com/tvararu/tuicraft/commit/4f37900600f1375ed040d64ed5f52700ba6a9ee9))
* Add duel accept/decline implementation plan ([e9406a4](https://github.com/tvararu/tuicraft/commit/e9406a44ad4c0c1a23c55c979d3efe282e270114))
* Add guild events design ([9f7f506](https://github.com/tvararu/tuicraft/commit/9f7f506c2a62a5a76545a6a6e36c0b1d6a7e7860))
* Add guild events implementation plan ([0e6ebdd](https://github.com/tvararu/tuicraft/commit/0e6ebdd9c549c9f0b6aadf7e63a0298cec91706a))
* Add guild management commands design ([d0c26ea](https://github.com/tvararu/tuicraft/commit/d0c26eafec1c135b405b8d133de91375bf54408a))
* Add guild management implementation plan ([6e0b0b6](https://github.com/tvararu/tuicraft/commit/6e0b0b66a11bff154aad1aff8463658648398f4b))
* Add mail notifications design ([fc739ce](https://github.com/tvararu/tuicraft/commit/fc739ce9fbf895e34fe8b9c6662d6ca2f8b673a0))
* Add mail notifications implementation plan ([285898e](https://github.com/tvararu/tuicraft/commit/285898e59a218e645c4e3ec0bb4fe897349d51be))
* Document guild management commands ([e7c567c](https://github.com/tvararu/tuicraft/commit/e7c567cce5fe821e4d4131a150038e58014c83fc))
* Mark duel and mail notifications as done ([7b0a24c](https://github.com/tvararu/tuicraft/commit/7b0a24c948db6ffbce277e113f284882208e2cb1))
* Mark guild events as done ([3c9dc40](https://github.com/tvararu/tuicraft/commit/3c9dc40d42fff7de5d90d41304ef5838bcf2b9ad))
* Update help text for context-aware accept ([83927ad](https://github.com/tvararu/tuicraft/commit/83927ad490b568269583eb77708ed4fb38a44f64))


### Maintenance

* Add coverage for guild management commands ([e0a7c6a](https://github.com/tvararu/tuicraft/commit/e0a7c6a19dd28ee025791cddefb7bdc6999131ef))
* Add duel event format tests ([ae0fc87](https://github.com/tvararu/tuicraft/commit/ae0fc87c678f179cef4cd4f50b2b4036e0293532))
* Add duel handler integration tests ([706b880](https://github.com/tvararu/tuicraft/commit/706b88087db7f0dd748a7d249d2b677d54a03ee9))
* Cover group accept/decline paths ([d00109a](https://github.com/tvararu/tuicraft/commit/d00109a8575f3e8f98a25dad46fdbc3f9b93ed53))
* Cover remaining guild command paths ([e83a4e1](https://github.com/tvararu/tuicraft/commit/e83a4e1c881be1401c18a8615606241294a7a57c))
* Remove guild management stubs ([43dda45](https://github.com/tvararu/tuicraft/commit/43dda458fb575b2e586afe3f6e32dd9bd240de8a))
* Remove SMSG_GUILD_EVENT stub ([3bba8fd](https://github.com/tvararu/tuicraft/commit/3bba8fd99f6eba3ce14edb393f5a24e477213553))
* Update mocks for DuelEvent ([64bd2fb](https://github.com/tvararu/tuicraft/commit/64bd2fb37637d3ef75c5e59afa7025895136be73))

## [0.4.2](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.4.1...tuicraft-v0.4.2) (2026-03-03)


### Features

* Add channel join/leave packet builders ([43ba07b](https://github.com/tvararu/tuicraft/commit/43ba07bde43604cd61b53370dfc04755aad14e4c))
* Add guild roster support ([e5569f5](https://github.com/tvararu/tuicraft/commit/e5569f5b5c10f5d9d89212b8899ca6d11efd7dba))
* Add joinChannel/leaveChannel to WorldHandle ([4386bcf](https://github.com/tvararu/tuicraft/commit/4386bcf6e4a4d2d2c2a48a3fd8fbcc15acd79dff))
* Add server-side ignore list ([32dc2c7](https://github.com/tvararu/tuicraft/commit/32dc2c7bdf1ce960191c8b7f189133a3f889ea1a))
* Handle /join and /leave in interactive TUI ([031c58b](https://github.com/tvararu/tuicraft/commit/031c58b2b86e497c40cdabe252d92c9836146720))
* Parse /join and /leave channel commands ([da01515](https://github.com/tvararu/tuicraft/commit/da01515f7a59d115e486bc6a5fb6ca505718d9dc))
* Surface channel notify events to user ([e10d1dc](https://github.com/tvararu/tuicraft/commit/e10d1dca87b90a5009efb66e14e3da86f68b2e70))
* Wire channel join/leave through IPC dispatch ([2cdeb86](https://github.com/tvararu/tuicraft/commit/2cdeb8698e1eee8ca7aa871a2760f0aa258c4c7f))
* Wire guild roster through IPC and TUI ([de232a7](https://github.com/tvararu/tuicraft/commit/de232a7883462de597858a8a0ded7b19728d6bc2))


### Bug Fixes

* Resolve guild roster race condition and rank alignment ([7fce77b](https://github.com/tvararu/tuicraft/commit/7fce77bd6d8dbb57762063f11ccd2f3a4717df13))


### Documentation

* Add guild roster documentation ([341f430](https://github.com/tvararu/tuicraft/commit/341f430bbbc081c050f1cc803a19e59ff22b9fc8))
* Add ignore list design ([db406e1](https://github.com/tvararu/tuicraft/commit/db406e1f3ba9e938862a8d779f9562387eb910a0))


### Maintenance

* Add channel join/leave documentation ([cba77ef](https://github.com/tvararu/tuicraft/commit/cba77efbab3ea2ab91c09f99804890b1f9b9c4c5))
* Add channel join/leave integration tests ([7989141](https://github.com/tvararu/tuicraft/commit/79891412470cf2a4485bdd1dbc4e9698aabaa754))
* Add guild roster test coverage ([b606fb4](https://github.com/tvararu/tuicraft/commit/b606fb43e435ac5c37a11a03e3141beb6c46779c))
* Add ignore list integration tests ([09347d9](https://github.com/tvararu/tuicraft/commit/09347d922dba8b33287155fada0fd800bc389351))
* Reach 100% line and function coverage ([0b03513](https://github.com/tvararu/tuicraft/commit/0b03513ab8253805d45478aeb03a0a991412b79b))
* Simplify channel command password handling ([f7eb9c6](https://github.com/tvararu/tuicraft/commit/f7eb9c696c3e9cafc344fd7ade309954eb289aa5))

## [0.4.1](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.4.0...tuicraft-v0.4.1) (2026-03-01)


### Features

* Add /dnd and /afk status commands ([672b3b3](https://github.com/tvararu/tuicraft/commit/672b3b33592049e775903fb2b602c59226bcee0e))
* Add /roll command ([5339fa7](https://github.com/tvararu/tuicraft/commit/5339fa7b0f78f00fd721f5e060186a4fcf626974))
* Add friend list commands and event pipeline ([5b4a5bd](https://github.com/tvararu/tuicraft/commit/5b4a5bd37361c069ce1a5970ae427fcbcc7a28ed))
* Add FriendStore for friend list state ([6f2cb00](https://github.com/tvararu/tuicraft/commit/6f2cb007aaf4158f49e407a8b5c66a60bc333622))
* Add server broadcast and notification parsers ([4e1650a](https://github.com/tvararu/tuicraft/commit/4e1650a05dcb05f8ad717b6f6966e1dea4098023))
* Add social protocol module ([f9260da](https://github.com/tvararu/tuicraft/commit/f9260da1e27ed56361d52d850d9354684ad58c94))
* Add text emote support ([a9c2234](https://github.com/tvararu/tuicraft/commit/a9c22341c345b426ab744f22c82aa2af279d85f3))
* Display server broadcasts with [server] label ([81adc6d](https://github.com/tvararu/tuicraft/commit/81adc6d33df1df5ed462c1a87fc8f86dfe374e3a))
* Handle server broadcast and notification packets ([f6be290](https://github.com/tvararu/tuicraft/commit/f6be29078f489b2f66449ac2bb5eb6fa0759397f))
* Handle SMSG_CHAT_RESTRICTED opcode ([3705a2d](https://github.com/tvararu/tuicraft/commit/3705a2d0fc7103515c49e0e7bfa6248c24e04bbf))
* Handle SMSG_CHAT_WRONG_FACTION opcode ([aed37a4](https://github.com/tvararu/tuicraft/commit/aed37a4fa7b1688d256796abd92fe210eabf5f55))
* Wire friend list handlers in client ([024bfda](https://github.com/tvararu/tuicraft/commit/024bfdadfec75447399d3ba3ceec56f8ba58402f))


### Bug Fixes

* Address review feedback on server broadcasts ([42b7e85](https://github.com/tvararu/tuicraft/commit/42b7e85e11f273a003f0069049854e432b5fd459))
* Address review findings for friend list ([507fd73](https://github.com/tvararu/tuicraft/commit/507fd73a1abe7ca9694aa8f62b61e7bc2e15aced))
* Restore /2 in help text dropped during emote addition ([398f0be](https://github.com/tvararu/tuicraft/commit/398f0be82db28424dd596bad4c67ca526ca85a0a))


### Documentation

* Add file split implementation plan ([500cf6c](https://github.com/tvararu/tuicraft/commit/500cf6cdd1fa33085177da990b20385fe749acb8))
* Add file split refactoring design ([5ec3b98](https://github.com/tvararu/tuicraft/commit/5ec3b9827be4813a69498425bf7c51bde72537d8))
* Add friend list design and implementation plan ([b2c98ce](https://github.com/tvararu/tuicraft/commit/b2c98cebd40b6a63fd746ddc780b85c8a14e19d5))
* Add friend list to all documentation ([25f1e51](https://github.com/tvararu/tuicraft/commit/25f1e514073cef803692dad61f1edbfddc06941a))
* Add screenshot ([e10fa0d](https://github.com/tvararu/tuicraft/commit/e10fa0da4d3fde3e04b834f78b88b70bf9353623))
* Add server broadcast implementation plan ([e919c5a](https://github.com/tvararu/tuicraft/commit/e919c5ae142dc974e727eec8164ff54339cc5677))
* Add server broadcast messages design ([a19f5a5](https://github.com/tvararu/tuicraft/commit/a19f5a55995e643623d064b2cc4e6ab3f765808e))
* Update workflow ([1023656](https://github.com/tvararu/tuicraft/commit/10236569abeeae2946516e7a757e067289487089))


### Maintenance

* Add friend list integration tests ([9a8928a](https://github.com/tvararu/tuicraft/commit/9a8928a1d345499a72e580a81519cd01b1452f60))
* Add whisper-without-message branch test ([d51b25e](https://github.com/tvararu/tuicraft/commit/d51b25ea1d1a72486d464e782836a9c34829439b))
* Bump coverage to 100% functions and lines ([c8b5409](https://github.com/tvararu/tuicraft/commit/c8b54093bf60081d63af829bca14faaa1ecf8c14))
* Cover all SERVER_MESSAGES formatters ([deb9598](https://github.com/tvararu/tuicraft/commit/deb95988934d5a3637916a8674cef392ad6c283f))
* Cover sendDnd and sendAfk in client integration tests ([f226e9b](https://github.com/tvararu/tuicraft/commit/f226e9b0a23c2906419e6322139070159f1c31c9))
* Extract auth handshake to wow/auth.ts ([84f713d](https://github.com/tvararu/tuicraft/commit/84f713d1a357779366008a8df04461126ce27903))
* Extract command parsing to ui/commands.ts ([b39876c](https://github.com/tvararu/tuicraft/commit/b39876cacdf84becf73975f04d1b0f191235aac0))
* Extract formatters to ui/format.ts ([3e513ed](https://github.com/tvararu/tuicraft/commit/3e513ed3ad77cc33ebb5b1f1206d64ed46c227c4))
* Extract world packet handlers ([f850f6e](https://github.com/tvararu/tuicraft/commit/f850f6e1614528c1ef1d6d0220593cdd884e2673))
* Point external imports at new modules ([2e76cdc](https://github.com/tvararu/tuicraft/commit/2e76cdc2b71ac1c33303463ef9281d1cea92f21a))
* Reach 100% coverage on commands.ts ([9a6e4b2](https://github.com/tvararu/tuicraft/commit/9a6e4b234e4e92e52ac2ccb5f7f6914bac7e61b6))
* Remove bugs.md ([93e0ff9](https://github.com/tvararu/tuicraft/commit/93e0ff9256eadd0d9198565d1d94a7588cbac379))
* Remove server broadcast and notification stubs ([9681542](https://github.com/tvararu/tuicraft/commit/9681542985dce0d24912c458f0841213c761437b))
* Split client.test.ts into auth, handler, and session tests ([7a3276d](https://github.com/tvararu/tuicraft/commit/7a3276d00abe1e879b25c23ab0a9ab743db2e855))
* Split tui.test.ts into commands, format, and runtime tests ([abe4a0b](https://github.com/tvararu/tuicraft/commit/abe4a0bbf28ce30b93bd8989df41a6ad8e2a63aa))
* Unstub chat notices, update README ([811274a](https://github.com/tvararu/tuicraft/commit/811274ad8a388c0c106d0d9301f962c2d0a66dd0))
* Update remaining imports, remove re-exports ([c650bb6](https://github.com/tvararu/tuicraft/commit/c650bb6f6bcba7dbbd81718dcb65c56887d69dd0))
* Use promise-based waitForCapture for ping test ([2d3dd68](https://github.com/tvararu/tuicraft/commit/2d3dd68456e1cd32c2e64a18bd0875e1231994e1))
* Wait for CMSG_PING via captured packets instead of sleep ([dc9ecfd](https://github.com/tvararu/tuicraft/commit/dc9ecfd9d8f320cb8fcd35ac1b9f32f72fc5a26b))

## [0.4.0](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.10...tuicraft-v0.4.0) (2026-02-26)


### ⚠ BREAKING CHANGES

* Add /tuicraft entities toggle and entity event display

### Features

* Add /tuicraft entities toggle and entity event display ([fad9124](https://github.com/tvararu/tuicraft/commit/fad9124e8486387e64de6b7be7e12fdd5d99996a))
* Add creature and game object query builders and parsers ([d35d22c](https://github.com/tvararu/tuicraft/commit/d35d22c5a1e0199394525c81815f9bc5b6eda73c))
* Add entity store with typed entities and event callbacks ([2809d04](https://github.com/tvararu/tuicraft/commit/2809d041e117b2d682eabf584057e4c30a7a595f))
* Add entity type definitions and field offset tables ([62c3c45](https://github.com/tvararu/tuicraft/commit/62c3c45832f92e0f7a0f3639775f142b56798865))
* Add field extraction from update mask to typed entities ([d248b22](https://github.com/tvararu/tuicraft/commit/d248b22c915ed63229ac00fecd448efcf2b9eaa7))
* Add movement block parser for SMSG_UPDATE_OBJECT ([256850e](https://github.com/tvararu/tuicraft/commit/256850e391f4e782f805bfef83eef38ca79299a0))
* Add NEARBY verb and entity events to daemon IPC ([6e1ee9b](https://github.com/tvararu/tuicraft/commit/6e1ee9b9c7d124dfcd83ceb9a0db71738e2d8de3))
* Add SMSG_UPDATE_OBJECT top-level packet parser ([95d8b5f](https://github.com/tvararu/tuicraft/commit/95d8b5fa8a44461d7a32ab4cf7866558dfc6e9ba))
* Add uint64LE to PacketReader and PacketWriter ([c60c89c](https://github.com/tvararu/tuicraft/commit/c60c89cca980e81387133af26cac916637b35dac))
* Add update mask parser for SMSG_UPDATE_OBJECT ([679b81c](https://github.com/tvararu/tuicraft/commit/679b81c4bd36898e3e224c69810454eb8edfa823))
* Wire SMSG_UPDATE_OBJECT handler into world session ([e40fc13](https://github.com/tvararu/tuicraft/commit/e40fc13ad7504c727906f84ca824d7bdefca2a75))


### Bug Fixes

* Clear entity event listener before closing socket ([4df0a3e](https://github.com/tvararu/tuicraft/commit/4df0a3e42989a99e9a75d33a410f3b2d2ab65b9c))
* Correct spline flags, entity store edge cases, and partial field updates ([8e9322d](https://github.com/tvararu/tuicraft/commit/8e9322d314df2a632398b900642605b61ba5d4d1))
* Replace stderr packet error logging with callback and recover partial updates ([823f59c](https://github.com/tvararu/tuicraft/commit/823f59c1e73823afc5914430320f5f3b8552b31c))
* Strip leaked fields from entity create, deduplicate name queries, and log entity events ([d2bac0a](https://github.com/tvararu/tuicraft/commit/d2bac0a0828e2fc2285387145130a73182f18f5e))
* Suppress unnamed entity appear events and resolve names eagerly ([213430a](https://github.com/tvararu/tuicraft/commit/213430aa75d83041cf4afd6af4480a69228cb598))


### Documentation

* Add entity parsing design for v0.4 ([45cf436](https://github.com/tvararu/tuicraft/commit/45cf4367fc746f3dd1b2cac4c52e29ba4493d09c))
* Add entity parsing implementation plan ([7bba676](https://github.com/tvararu/tuicraft/commit/7bba676cd93cd4161c4d28923b2f95b095ef3f81))
* Add entity tracking to help, manual, SKILL.md, and README ([11c62a7](https://github.com/tvararu/tuicraft/commit/11c62a7782cf96ddaccfd15ecf26613e36ad5968))
* Add test coverage, teardown ordering, and entity field notes to CLAUDE.md ([271c9f5](https://github.com/tvararu/tuicraft/commit/271c9f5224b8925ea102cb834d830ee1ce4f78ad))
* Note that entity-fields.ts is a subset of UpdateFields.h ([5d9aa6c](https://github.com/tvararu/tuicraft/commit/5d9aa6c7e20d78bb379976bd09a7db0a51a08b7d))
* Update CLAUDE.md conventions ([6a89daa](https://github.com/tvararu/tuicraft/commit/6a89daa7b229eec25d5dd3aad9dae746c8e1b18c))


### Maintenance

* Add entity handler integration tests and reach 100% line coverage ([b7f6d89](https://github.com/tvararu/tuicraft/commit/b7f6d892ed0e80aad5ffe76ec6395132003252c1))
* Add entity tracking live tests and fix three protocol bugs ([1f7e796](https://github.com/tvararu/tuicraft/commit/1f7e7965d8b4419f32f241696bc5320019b95bed))
* Reach 100% function coverage across all files ([c4dd793](https://github.com/tvararu/tuicraft/commit/c4dd793e30a46f87b86a8c859fe435c6681e7973))
* Remove 6 redundant tests and fold nearObjects into existing test ([409d2d3](https://github.com/tvararu/tuicraft/commit/409d2d3ef415f53fbcb14a97f5aeba6613c221bf))
* Remove implemented opcodes from stub registry ([a2f867c](https://github.com/tvararu/tuicraft/commit/a2f867cb7eccc47e6696ea06f68b66dfb8a8b76c))
* Update license reference ([6a43eda](https://github.com/tvararu/tuicraft/commit/6a43eda1973e9f62a19419f9dd14491b8fdaa2f4))

## [0.3.10](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.9...tuicraft-v0.3.10) (2026-02-24)


### Maintenance

* Switch to AGPLv3 ([c2c3b26](https://github.com/tvararu/tuicraft/commit/c2c3b265f442cbcfc22d449e88d99bcf995342de))

## [0.3.9](https://github.com/tvararu/tuicraft/compare/tuicraft-v0.3.8...tuicraft-v0.3.9) (2026-02-23)


### Features

* Add `tuicraft skill` subcommand ([d6c6507](https://github.com/tvararu/tuicraft/commit/d6c650753a1b00218b7e09045ef2c3db435f5881))


### Maintenance

* Add entire introspect skill and CLAUDE.md reference ([f5e6f64](https://github.com/tvararu/tuicraft/commit/f5e6f6443ffc56643b51504b9f5e37d57d79e609))
* Add shared permission allow-list to project settings ([275006a](https://github.com/tvararu/tuicraft/commit/275006aa93a4ad09d504db592de202297acc563c))
* Remove MISE_TASK_TIMEOUT and task_timeout entirely ([87ab591](https://github.com/tvararu/tuicraft/commit/87ab59111491c657fae37b2e48cda3d726797f93))

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
