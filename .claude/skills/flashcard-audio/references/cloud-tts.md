# Cloud text-to-speech

Read this when the system voices aren't good enough, when a locale isn't
installed, or when the person asking has already picked a provider.

Prices below are list prices for standard neural voices as of 2026 and move
around; check the provider's page before quoting a figure to anyone. A hundred
flashcards is roughly 500–1,000 characters, so for a single deck every option
here is free or costs pennies. Cost only becomes real at thousands of cards or
whole-sentence content.

## Contents

- [Which to pick](#which-to-pick)
- [Google Cloud Text-to-Speech](#google-cloud-text-to-speech)
- [Azure AI Speech](#azure-ai-speech)
- [Amazon Polly](#amazon-polly)
- [OpenAI](#openai)
- [ElevenLabs](#elevenlabs)
- [Forvo](#forvo)
- [SSML: controlling delivery](#ssml-controlling-delivery)
- [Wiring a provider into the batch script](#wiring-a-provider-into-the-batch-script)

## Which to pick

| Need | Provider |
|---|---|
| Best Mandarin, wide locale coverage | Azure or Google |
| Already on AWS | Polly |
| Simplest API, no cloud console | OpenAI |
| Most natural English, voice cloning | ElevenLabs |
| Real human recordings, not synthesis | Forvo |

For Chinese specifically, Azure and Google both offer mainland (`zh-CN`),
Taiwan (`zh-TW`) and Cantonese (`zh-HK`) neural voices, and both handle tones
correctly on isolated words — which is where cheaper engines fall down, because
a single character out of context is exactly the hard case.

## Google Cloud Text-to-Speech

The provider behind most Anki decks with `google-*.mp3` media, usually via the
HyperTTS or AwesomeTTS add-on.

- Free tier: 1M characters/month for standard voices, 100k for WaveNet/Neural2
- Voices: `cmn-CN-Wavenet-A` … `-D`, `cmn-TW-*`, `yue-HK-*`
- Auth: service account JSON, or an API key for the REST endpoint

```bash
curl -s -X POST \
  "https://texttospeech.googleapis.com/v1/text:synthesize?key=$GOOGLE_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "input": {"text": "学校"},
    "voice": {"languageCode": "cmn-CN", "name": "cmn-CN-Wavenet-A"},
    "audioConfig": {"audioEncoding": "MP3", "speakingRate": 0.9}
  }' | python3 -c "import sys,json,base64;open('out.mp3','wb').write(base64.b64decode(json.load(sys.stdin)['audioContent']))"
```

The response is base64 inside JSON, not raw audio — decode it as above.

## Azure AI Speech

Generally the strongest Mandarin voices, and the most locale coverage.

- Free tier: 500k characters/month
- Voices: `zh-CN-XiaoxiaoNeural`, `zh-CN-YunxiNeural`, `zh-TW-HsiaoChenNeural`,
  `zh-HK-HiuMaanNeural`
- Auth: a subscription key plus a region

```bash
curl -s -X POST \
  "https://$AZURE_REGION.tts.speech.microsoft.com/cognitiveservices/v1" \
  -H "Ocp-Apim-Subscription-Key: $AZURE_KEY" \
  -H 'Content-Type: application/ssml+xml' \
  -H 'X-Microsoft-OutputFormat: audio-24khz-48kbitrate-mono-mp3' \
  -d '<speak version="1.0" xml:lang="zh-CN">
        <voice name="zh-CN-XiaoxiaoNeural">
          <prosody rate="-10%">学校</prosody>
        </voice>
      </speak>' --output out.mp3
```

Azure returns audio directly. It takes SSML rather than plain text, which is
what makes the `prosody` control above possible.

## Amazon Polly

Worth using if the surrounding infrastructure is already AWS; otherwise it has
no particular advantage for Chinese.

- Free tier: 5M characters/month for the first 12 months
- Voices: `Zhiyu` (`cmn-CN`) is the main Mandarin neural voice

```bash
aws polly synthesize-speech \
  --engine neural --language-code cmn-CN --voice-id Zhiyu \
  --output-format mp3 --text "学校" out.mp3
```

## OpenAI

The least setup of the cloud options: one key, one endpoint, no cloud console.
Voices are not language-specific — the same voice reads whatever you give it,
picking up the language from the text — which makes it convenient for a mixed
deck but gives you less control over accent.

```bash
curl -s https://api.openai.com/v1/audio/speech \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model": "gpt-4o-mini-tts", "voice": "alloy", "input": "学校"}' \
  --output out.mp3
```

## ElevenLabs

The most natural-sounding English, and voice cloning if you want a consistent
narrator across a deck. More expensive per character, and its strength is
sentences rather than isolated vocabulary — for single words the advantage over
Azure or Google is small.

- Multilingual model handles Chinese; quality on isolated characters is
  noticeably weaker than on running speech
- Auth: `xi-api-key` header

## Forvo

Not synthesis: a library of real people pronouncing real words, which is the
authentic option when that matters more than coverage. Its API is paid, coverage
varies by word, and licensing restricts redistribution — read the terms before
shipping a deck built from it to anyone else.

## SSML: controlling delivery

Azure, Google and Polly all accept SSML, which is the reason to prefer them when
delivery matters:

```xml
<speak version="1.0" xml:lang="zh-CN">
  <voice name="zh-CN-XiaoxiaoNeural">
    <prosody rate="-20%">学校</prosody>
    <break time="300ms"/>
    <prosody rate="-20%">学校</prosody>
  </voice>
</speak>
```

Two useful patterns for language decks: slow single words with `prosody rate`,
since neural voices clip isolated words short; and say a word twice with a
`break` between, which suits listening practice and costs one file rather than
two.

## Wiring a provider into the batch script

`scripts/make-audio.py` shells out to `say` in one function, `speak()`. To use a
cloud provider, replace that function's body with an HTTP call and leave the
rest alone — the deduplication, the stable filenames, the skip-if-filled
behaviour and the zip packaging are all provider-independent.

Two things to keep when you do:

- **The duration check.** Cloud APIs fail differently from `say` — they return
  an error document or an empty body rather than silence — but a check that
  every clip has real length catches a bad batch either way, and it is the only
  test that doesn't depend on knowing how a given provider fails.
- **The cache.** Filenames are a digest of text and voice, so a re-run doesn't
  re-synthesise what already exists. With a metered API that is the difference
  between one bill and one per attempt.

Keep the key in the environment rather than in the script, so a repository
holding a deck never holds a credential.
