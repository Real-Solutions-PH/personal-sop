"use client"

import {
  Captions,
  CaptionsOff,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"

// The 17-second "Say it. It's tracked." film, built from design-system
// screens and the Fern sprite (unfurl-marketing, project say-it-tracked).
// The poster paints first; the video file is not requested until the page
// has loaded and the phone is on screen, so it never competes with the
// first view. Autoplays muted and loops, unless the person asked for reduced
// motion, in which case it waits for Play. Sound and captions start off; each
// has its own button.
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null)
  const [src, setSrc] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [captions, setCaptions] = useState(false)
  const [sound, setSound] = useState(false)
  // The poster is a real image (the page's largest paint) and stays on top
  // until the film has a frame to show.
  const [frame, setFrame] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let io: IntersectionObserver | null = null
    const arm = () => {
      io = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting) {
            // Under reduced motion nothing is fetched until Play is pressed.
            if (!reduce) {
              el.autoplay = true
              setSrc(true)
            }
            io?.disconnect()
          }
        },
        { rootMargin: "100px" },
      )
      io.observe(el)
    }
    if (document.readyState === "complete") arm()
    else window.addEventListener("load", arm, { once: true })
    return () => {
      window.removeEventListener("load", arm)
      io?.disconnect()
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !src) return
    el.load()
    if (el.autoplay) el.play().catch(() => setPlaying(false))
  }, [src])

  // Sound never plays from a film the visitor can't see: once it scrolls
  // out of view it mutes, and the button says so.
  useEffect(() => {
    const el = ref.current
    if (!el || !sound) return
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) {
        el.muted = true
        setSound(false)
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [sound])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const track = el.textTracks[0]
    if (track) track.mode = captions ? "showing" : "hidden"
  }, [captions])

  // Sound is the person's choice: turning it on also starts the film.
  const toggleSound = () => {
    const el = ref.current
    if (!el) return
    const on = !sound
    el.muted = !on
    setSound(on)
    if (on) {
      if (!src) {
        el.autoplay = true
        setSrc(true)
      } else if (el.paused) el.play().catch(() => setPlaying(false))
    }
  }

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (!src) {
      el.autoplay = true
      setSrc(true)
      return
    }
    if (el.paused) el.play().catch(() => setPlaying(false))
    else el.pause()
  }

  return (
    <figure style={{ margin: 0 }}>
      <div className="phone">
        <video
          ref={ref}
          muted
          loop
          playsInline
          preload="none"
          width={540}
          height={960}
          aria-label="A 17-second film: one typed sentence becomes an expense, a workout and a task, then Fern answers a question about food spending."
          onPlay={() => setPlaying(true)}
          onPlaying={() => setFrame(true)}
          onPause={() => setPlaying(false)}
        >
          {src && (
            <>
              <source src="/media/say-it-tracked.webm" type="video/webm" />
              <source src="/media/say-it-tracked.mp4" type="video/mp4" />
            </>
          )}
          <track
            kind="captions"
            src="/media/say-it-tracked.en.vtt"
            srcLang="en"
            label="English"
          />
        </video>
        {/* biome-ignore lint/performance/noImgElement: static export, no image optimiser */}
        <img
          className={`poster ${frame ? "gone" : ""}`}
          src="/media/say-it-tracked-poster.webp"
          alt=""
          width={540}
          height={960}
          fetchPriority="high"
          decoding="async"
        />
        <div className="video-controls">
          <button
            type="button"
            className="vbtn"
            onClick={toggle}
            aria-label={playing ? "Pause the film" : "Play the film"}
          >
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            {playing ? "Pause" : "Play"}
          </button>
          <span className="vbtn-group">
            <button
              type="button"
              className="vbtn"
              onClick={toggleSound}
              aria-pressed={sound}
              aria-label={sound ? "Turn sound off" : "Turn sound on"}
            >
              {sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
            </button>
            <button
              type="button"
              className="vbtn"
              onClick={() => setCaptions((c) => !c)}
              aria-pressed={captions}
              aria-label="Captions"
            >
              {captions ? (
                <Captions aria-hidden />
              ) : (
                <CaptionsOff aria-hidden />
              )}
            </button>
          </span>
        </div>
      </div>
    </figure>
  )
}
