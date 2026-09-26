import { createNavigation } from "wow/navigation";
import type { NativeMap } from "wow/navigation-native";

export function native(over: Partial<NativeMap> = {}): NativeMap {
  return {
    close: () => {},
    findHeight: () => 0,
    findHeights: () => [0],
    findPath: (from, to) => [{ ...from }, { ...to }],
    lineOfSight: () => true,
    loadAdtAt: () => {},
    ...over,
  };
}

export function navigation(map: NativeMap) {
  return createNavigation(
    { dataPath: "fixture", libraryPath: "fixture" },
    () => map,
  );
}
