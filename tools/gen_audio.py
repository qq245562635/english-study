"""用 Kokoro（开源神经网络语音，Apache-2.0）为词库和句子生成美式发音 MP3。

用法：
  pip install kokoro-onnx soundfile
  下载 kokoro-v1.0.int8.onnx 和 voices-v1.0.bin（https://github.com/thewh1teagle/kokoro-onnx/releases）
  python tools/gen_audio.py MODEL.onnx VOICES.bin
已经生成过的句子会跳过，所以加了新单词后重新运行即可。
"""
import hashlib, json, os, re, subprocess, sys, tempfile
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = "af_heart"
EXTRA = ["Hi, nice to meet you. How's it going?"]


def texts():
    out = []
    words = open(os.path.join(ROOT, "data/words.js"), encoding="utf-8").read()
    body = words.split("`")[1]
    for line in body.strip().split("\n"):
        p = line.split("|")
        out += [p[0], p[3]]
    phrases = open(os.path.join(ROOT, "data/phrases.js"), encoding="utf-8").read()
    for block in re.findall(r"lines: `(.*?)`", phrases, re.S):
        for line in block.strip().split("\n"):
            out.append(line.split("|")[0])
    # 阅读短文：每段一个录音（用 node 读取 JS 数据，避免手写解析）
    js = ("global.window={};require(process.argv[1]);"
          "console.log(JSON.stringify(window.READINGS.flatMap(r=>[r.title,...r.paras.map(p=>p[0])])))")
    out += json.loads(subprocess.run(["node", "-e", js, os.path.join(ROOT, "data/readings.js")],
                                     capture_output=True, text=True, check=True).stdout)
    out += EXTRA
    seen, res = set(), []
    for t in out:
        if t not in seen:
            seen.add(t); res.append(t)
    return res


def key(t):
    return hashlib.sha1(t.encode("utf-8")).hexdigest()[:12]


def main(model, voices):
    k = Kokoro(model, voices)
    adir = os.path.join(ROOT, "audio")
    os.makedirs(adir, exist_ok=True)
    manifest = {}
    all_t = texts()
    for i, t in enumerate(all_t):
        name = key(t)
        manifest[t] = name
        mp3 = os.path.join(adir, name + ".mp3")
        if os.path.exists(mp3):
            continue
        # 单个单词后面加句号，读起来更自然
        say = t if re.search(r"[.?!,]$", t) else t + "."
        samples, sr = k.create(say, voice=VOICE, speed=0.95, lang="en-us")
        with tempfile.NamedTemporaryFile(suffix=".wav") as f:
            sf.write(f.name, samples, sr)
            subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", f.name,
                            "-af", "silenceremove=start_periods=1:start_threshold=-50dB",
                            "-ac", "1", "-b:a", "48k", mp3], check=True)
        print(f"{i + 1}/{len(all_t)} {t}", flush=True)
    with open(os.path.join(adir, "index.js"), "w", encoding="utf-8") as f:
        f.write("// 自动生成：文本 -> 音频文件名\nwindow.AUDIO = ")
        json.dump(manifest, f, ensure_ascii=False, indent=0)
        f.write(";\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
