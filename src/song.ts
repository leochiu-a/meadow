// 〈紅樓之夜〉, the song A-Sheng played in his record shop every morning: an original little
// waltz on the pentatonic scale. The same notes come from the radio at the clean-up, the
// robot's speaker and Xiaomai's music box. [midi, beats]; one beat is BEAT seconds.
export const BEAT = 0.42
export type Note = [midi: number, beats: number]
export const SONG: Note[] = [
  [76, 1], [79, 1], [81, 1], [79, 1], [76, 1], [74, 1], [72, 1], [74, 1], [76, 1], [74, 3],
  [76, 1], [79, 1], [81, 1], [84, 1], [81, 1], [79, 1], [81, 1], [79, 1], [76, 1], [79, 3],
  [81, 1], [84, 1], [86, 1], [84, 1], [81, 1], [79, 1], [76, 1], [79, 1], [81, 1], [79, 3],
  [76, 1], [74, 1], [72, 1], [74, 1], [76, 1], [79, 1], [76, 1], [74, 1], [74, 1], [72, 3],
]
export const SONG_SECONDS = SONG.reduce((s, [, b]) => s + b, 0) * BEAT
