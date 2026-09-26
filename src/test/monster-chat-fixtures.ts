import { parseChatMessage } from "wow/protocol/chat";
import { PacketReader } from "wow/protocol/packet";

const DARKWRAITH_FRENZY = new Uint8Array(
  Buffer.from(
    "1000000000a99207293d0030f1000000000b0000004461726b77726169746800000000000000000017000000257320676f657320696e746f2061206672656e7a79210000",
    "hex",
  ),
);

export function parseDarkwraithFrenzy() {
  return parseChatMessage(new PacketReader(DARKWRAITH_FRENZY));
}
