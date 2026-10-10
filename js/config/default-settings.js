/**
 * 默认设置（用户可被 Settings 覆盖并持久化到 localStorage）。
 * 音量值范围 0-100，50 = 当前默认音量（bus gain = 1.0）。
 */
export default {
  soundEnabled: true,   // 音效总开关（一键静音所有声音）
  musicEnabled: true,   // 音乐总开关
  hitSound: true,       // 击中音效开关（默认开；关闭获得更真实体验）
  musicVolume: 65,      // 音乐音量 0-100
  sfxVolume: 40,        // 音效音量 0-100（命中/爆炸）
  gunVolume: 50,        // 机枪音量 0-100
  engineVolume: 40,     // 引擎音量 0-100
};
