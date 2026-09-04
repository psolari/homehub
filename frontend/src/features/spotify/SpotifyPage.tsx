import { useEffect, useState } from "react";
import * as mdi from "@mdi/js";
import Icon from "@mdi/react";
import { useNavigate } from "react-router-dom";

import { get, post } from "../../shared/api/client";

type SpotifyMedia = {
  id?: string | null;
  uri?: string | null;
  type: string;
  name: string;
  subtitle?: string;
  image?: string | null;
  duration_ms?: number | null;
  explicit?: boolean;
  description?: string;
  external_url?: string | null;
};

type SpotifyOutput = {
  spotify_device_id?: string | null;
  name: string;
  type?: string;
  is_active: boolean;
  is_restricted: boolean;
  volume_percent?: number | null;
  supports_volume: boolean;
  available: boolean;
  homehub_device_id?: number | null;
  homehub_name?: string | null;
  homehub_model?: string | null;
  unavailable_reason?: string;
};

type SpotifyPlayback = {
  is_playing: boolean;
  item?: SpotifyMedia | null;
  device?: {
    id?: string | null;
    name?: string;
    type?: string;
    volume_percent?: number | null;
    supports_volume?: boolean;
    is_restricted?: boolean;
  } | null;
  progress_ms: number;
  shuffle_state: boolean;
  repeat_state: "off" | "track" | "context" | string;
};

type SpotifyHome = {
  profile: {
    display_name: string;
    image?: string | null;
    product?: string | null;
    country?: string | null;
  };
  playlists: SpotifyMedia[];
  radio_and_mixes: SpotifyMedia[];
  shows: SpotifyMedia[];
  episodes: SpotifyMedia[];
  top_tracks: SpotifyMedia[];
  recently_played: SpotifyMedia[];
  playback: SpotifyPlayback;
  queue: SpotifyMedia[];
  outputs: SpotifyOutput[];
  missing_scopes?: string[];
};

type SearchResults = {
  tracks: SpotifyMedia[];
  albums: SpotifyMedia[];
  playlists: SpotifyMedia[];
  shows: SpotifyMedia[];
  episodes: SpotifyMedia[];
};

type Tab = "home" | "playlists" | "podcasts" | "mixes" | "search";

const paths = mdi as unknown as Record<string, string>;

function formatDuration(ms?: number | null) {
  if (!ms) return "0:00";
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function mediaIcon(type: string) {
  const icons: Record<string, string> = {
    track: "mdiMusicNote",
    album: "mdiAlbum",
    playlist: "mdiPlaylistMusic",
    show: "mdiPodcast",
    episode: "mdiPodcast",
  };
  return paths[icons[type] || "mdiMusicNote"];
}

export default function SpotifyPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<SpotifyHome | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [selectedOutput, setSelectedOutput] = useState("");
  const [selectedShow, setSelectedShow] = useState<SpotifyMedia | null>(null);
  const [showEpisodes, setShowEpisodes] = useState<SpotifyMedia[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = async () => {
    const next = await get<SpotifyHome>("/spotify/home/");
    setData(next);
    setSelectedOutput((current) => {
      if (
        current &&
        next.outputs.some(
          (output) =>
            output.spotify_device_id === current && output.available,
        )
      ) {
        return current;
      }
      const active =
        next.playback.device?.id &&
        next.outputs.find(
          (output) => output.spotify_device_id === next.playback.device?.id,
        );
      if (active?.spotify_device_id) return active.spotify_device_id;
      const homehub = next.outputs.find(
        (output) => output.available && output.homehub_device_id,
      );
      if (homehub?.spotify_device_id) return homehub.spotify_device_id;
      return (
        next.outputs.find((output) => output.available)?.spotify_device_id || ""
      );
    });
  };

  const refreshPlayback = async () => {
    try {
      const next = await get<{
        playback: SpotifyPlayback;
        queue: SpotifyMedia[];
        outputs: SpotifyOutput[];
      }>("/spotify/playback/");
      setData((current) =>
        current
          ? {
              ...current,
              playback: next.playback,
              queue: next.queue,
              outputs: next.outputs,
            }
          : current,
      );
    } catch {
      // Keep the last known playback state; the next explicit action will show errors.
    }
  };

  useEffect(() => {
    void load().catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!data) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await get<{
          playback: SpotifyPlayback;
          queue: SpotifyMedia[];
          outputs: SpotifyOutput[];
        }>("/spotify/playback/");
        setData((current) =>
          current
            ? {
                ...current,
                playback: next.playback,
                queue: next.queue,
                outputs: next.outputs,
              }
            : current,
        );
      } catch {
        // Keep the last known player state while Spotify/Connect is temporarily unavailable.
      }
    }, 4500);
    return () => window.clearInterval(timer);
  }, [data !== null]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      await refreshPlayback();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Spotify action failed");
    } finally {
      setBusy("");
    }
  };

  const play = (item: SpotifyMedia) =>
    run(`play:${item.uri}`, async () => {
      if (!item.uri) throw new Error("Spotify did not return a playable URI.");
      await post("/spotify/play/", {
        uri: item.uri,
        device_id: selectedOutput || undefined,
      });
    });

  const control = (
    action: string,
    value?: unknown,
    extra: Record<string, unknown> = {},
  ) =>
    run(action, async () => {
      await post("/spotify/control/", {
        action,
        value,
        device_id: selectedOutput || undefined,
        ...extra,
      });
    });

  const transfer = (deviceId: string) =>
    run("transfer", async () => {
      await post("/spotify/transfer/", { device_id: deviceId, play: true });
      setSelectedOutput(deviceId);
    });

  const setVolume = (value: number) =>
    run("volume", async () => {
      await post("/spotify/volume/", {
        value,
        device_id: selectedOutput || undefined,
      });
    });

  const search = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    setError("");
    try {
      const next = await get<SearchResults>(
        `/spotify/search/?q=${encodeURIComponent(trimmed)}`,
      );
      setResults(next);
      setTab("search");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Spotify search failed");
    } finally {
      setSearching(false);
    }
  };

  const openShow = async (show: SpotifyMedia) => {
    if (!show.id) return;
    setSelectedShow(show);
    setShowEpisodes([]);
    try {
      const result = await get<{ episodes: SpotifyMedia[] }>(
        `/spotify/show-episodes/?show_id=${encodeURIComponent(show.id)}`,
      );
      setShowEpisodes(result.episodes);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not load podcast episodes",
      );
    }
  };

  if (!data) {
    return (
      <div className="mx-auto max-w-4xl py-16">
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/70 p-8 text-center">
          <Icon path={paths.mdiSpotify} size={2.4} className="mx-auto text-emerald-400" />
          <h1 className="mt-5 text-3xl font-bold">Spotify</h1>
          {error ? (
            <>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                {error}
              </p>
              <button
                onClick={() => navigate("/integrations")}
                className="mt-6 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-black hover:bg-emerald-500"
              >
                Open Spotify integration
              </button>
            </>
          ) : (
            <p className="mt-3 text-zinc-500">Loading your Spotify library…</p>
          )}
        </div>
      </div>
    );
  }

  const current = data.playback.item;
  const progressPercent = current?.duration_ms
    ? Math.min(100, (data.playback.progress_ms / current.duration_ms) * 100)
    : 0;

  return (
    <div className="space-y-6 pb-40">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="rounded-2xl bg-emerald-500 p-3 text-black shadow-lg shadow-emerald-950/30">
            <Icon path={paths.mdiSpotify} size={1.5} />
          </div>
          <div>
            <div className="text-xs uppercase tracking-[.18em] text-emerald-400">
              Spotify
            </div>
            <h1 className="text-3xl font-bold">
              {data.profile.display_name || "Your music"}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              Library, podcasts, search and Spotify Connect playback inside HomeHub.
            </p>
          </div>
        </div>

        <div className="flex min-w-[320px] flex-1 justify-end">
          <form
            className="flex w-full max-w-xl items-center rounded-full border border-zinc-700 bg-zinc-950 px-4 focus-within:border-emerald-500"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <Icon path={paths.mdiMagnify} size={0.8} className="text-zinc-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search songs, artists, albums, playlists or podcasts"
              className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-white outline-none"
            />
            {searching && <span className="text-xs text-zinc-500">Searching…</span>}
          </form>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-900 bg-emerald-950/30 p-3 text-sm text-emerald-200">
          {message}
        </div>
      )}

      <nav className="flex flex-wrap gap-2">
        {(
          [
            ["home", "Home", "mdiHome"],
            ["playlists", "Playlists", "mdiPlaylistMusic"],
            ["podcasts", "Podcasts", "mdiPodcast"],
            ["mixes", "Radio & mixes", "mdiRadio"],
            ["search", "Search", "mdiMagnify"],
          ] as [Tab, string, string][]
        ).map(([value, label, icon]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition ${
              tab === value
                ? "border-emerald-500 bg-emerald-500 text-black"
                : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-white"
            }`}
          >
            <Icon path={paths[icon]} size={0.65} />
            {label}
          </button>
        ))}
      </nav>

      {tab === "home" && (
        <div className="space-y-8">
          <MediaSection
            title="Made for your listening"
            subtitle="Your Spotify mixes, radio-style playlists and recurring personalised playlists that are present in your library."
            items={data.radio_and_mixes}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
            empty="No saved/followed personalised mixes or radio playlists were returned by Spotify."
          />
          <MediaSection
            title="Your top tracks"
            items={data.top_tracks}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
          />
          <MediaSection
            title="Recently played"
            items={data.recently_played}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
          />
          <MediaSection
            title="Saved playlists"
            items={data.playlists.slice(0, 12)}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
          />
          <MediaSection
            title="Podcasts"
            items={data.shows.slice(0, 12)}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
          />
        </div>
      )}

      {tab === "playlists" && (
        <MediaSection
          title="Your playlists"
          subtitle="Playlists you own or follow, including private playlists allowed by your Spotify permissions."
          items={data.playlists}
          onPlay={play}
          onOpenShow={openShow}
          busy={busy}
          large
        />
      )}

      {tab === "podcasts" && (
        <div className="space-y-8">
          <MediaSection
            title="Saved podcasts"
            items={data.shows}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
            large
          />
          <MediaSection
            title="Saved episodes"
            items={data.episodes}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
          />
        </div>
      )}

      {tab === "mixes" && (
        <div className="space-y-8">
          <MediaSection
            title="Radio & mixes"
            subtitle="Spotify does not expose its private radio-generation engine as a public API. HomeHub surfaces radio/mix/daylist/Discover Weekly/Release Radar playlists visible in your library, and you can find more with Search."
            items={data.radio_and_mixes}
            onPlay={play}
            onOpenShow={openShow}
            busy={busy}
            large
            empty="No radio or mix playlists are currently visible in your Spotify library. Try searching for an artist or genre plus “radio”."
          />
          <button
            type="button"
            onClick={() => {
              setQuery("radio");
              setTab("search");
              window.setTimeout(() => void search(), 0);
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-300 hover:border-emerald-700 hover:text-white"
          >
            <Icon path={paths.mdiRadio} size={0.7} />
            Search Spotify for radio playlists
          </button>
        </div>
      )}

      {tab === "search" && (
        <div className="space-y-8">
          {!results && (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center text-zinc-500">
              Search the full Spotify catalogue above.
            </div>
          )}
          {results && (
            <>
              <MediaSection
                title="Songs"
                items={results.tracks}
                onPlay={play}
                onOpenShow={openShow}
                busy={busy}
              />
              <MediaSection
                title="Playlists"
                items={results.playlists}
                onPlay={play}
                onOpenShow={openShow}
                busy={busy}
              />
              <MediaSection
                title="Albums"
                items={results.albums}
                onPlay={play}
                onOpenShow={openShow}
                busy={busy}
              />
              <MediaSection
                title="Podcasts"
                items={results.shows}
                onPlay={play}
                onOpenShow={openShow}
                busy={busy}
              />
              <MediaSection
                title="Episodes"
                items={results.episodes}
                onPlay={play}
                onOpenShow={openShow}
                busy={busy}
              />
            </>
          )}
        </div>
      )}

      {selectedShow && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-4" onMouseDown={() => setSelectedShow(null)}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-3xl border border-zinc-700 bg-zinc-900 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center gap-4 border-b border-zinc-800 bg-zinc-900/95 p-5 backdrop-blur">
              {selectedShow.image ? (
                <img src={selectedShow.image} alt="" className="h-20 w-20 rounded-xl object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-zinc-800">
                  <Icon path={paths.mdiPodcast} size={1.5} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase text-zinc-500">Podcast</div>
                <h2 className="truncate text-xl font-bold">{selectedShow.name}</h2>
                <div className="mt-1 text-sm text-zinc-500">{selectedShow.subtitle}</div>
              </div>
              <button onClick={() => setSelectedShow(null)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800">
                <Icon path={paths.mdiClose} size={0.8} />
              </button>
            </div>
            <div className="divide-y divide-zinc-800">
              {showEpisodes.map((episode) => (
                <div key={episode.uri || episode.id} className="flex gap-4 p-4">
                  {episode.image && <img src={episode.image} alt="" className="h-16 w-16 rounded-lg object-cover" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{episode.name}</div>
                    <div className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500">{episode.description}</div>
                    <div className="mt-2 text-xs text-zinc-600">{formatDuration(episode.duration_ms)}</div>
                  </div>
                  <button
                    onClick={() => void play(episode)}
                    className="self-center rounded-full bg-emerald-500 p-3 text-black"
                    title="Play episode"
                  >
                    <Icon path={paths.mdiPlay} size={0.75} />
                  </button>
                </div>
              ))}
              {!showEpisodes.length && <div className="p-6 text-sm text-zinc-500">Loading episodes…</div>}
            </div>
          </div>
        </div>
      )}

      <div className="fixed bottom-0 left-16 right-0 z-30 border-t border-zinc-800 bg-zinc-950/95 px-5 py-3 shadow-2xl backdrop-blur">
        <div className="mx-auto grid max-w-[1700px] items-center gap-4 lg:grid-cols-[1fr_auto_1fr]">
          <div className="flex min-w-0 items-center gap-3">
            {current?.image ? (
              <img src={current.image} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-zinc-500">
                <Icon path={paths.mdiMusicNote} size={1} />
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{current?.name || "Nothing playing"}</div>
              <div className="truncate text-xs text-zinc-500">{current?.subtitle || data.playback.device?.name || "Spotify"}</div>
            </div>
          </div>

          <div className="min-w-[300px]">
            <div className="flex items-center justify-center gap-3">
              <button
                title={data.playback.shuffle_state ? "Disable shuffle" : "Enable shuffle"}
                onClick={() => void control("shuffle", !data.playback.shuffle_state)}
                className={data.playback.shuffle_state ? "text-emerald-400" : "text-zinc-500 hover:text-white"}
              >
                <Icon path={paths.mdiShuffleVariant} size={0.72} />
              </button>
              <button onClick={() => void control("previous")} className="text-zinc-300 hover:text-white">
                <Icon path={paths.mdiSkipPrevious} size={0.9} />
              </button>
              <button
                onClick={() => void control(data.playback.is_playing ? "pause" : "resume")}
                className="rounded-full bg-white p-2.5 text-black hover:scale-105"
              >
                <Icon path={data.playback.is_playing ? paths.mdiPause : paths.mdiPlay} size={0.85} />
              </button>
              <button onClick={() => void control("next")} className="text-zinc-300 hover:text-white">
                <Icon path={paths.mdiSkipNext} size={0.9} />
              </button>
              <button
                title="Change repeat mode"
                onClick={() => {
                  const next = data.playback.repeat_state === "off" ? "context" : data.playback.repeat_state === "context" ? "track" : "off";
                  void control("repeat", next);
                }}
                className={data.playback.repeat_state !== "off" ? "text-emerald-400" : "text-zinc-500 hover:text-white"}
              >
                <Icon path={data.playback.repeat_state === "track" ? paths.mdiRepeatOnce : paths.mdiRepeat} size={0.72} />
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-600">
              <span className="w-9 text-right">{formatDuration(data.playback.progress_ms)}</span>
              <input
                type="range"
                min="0"
                max="100"
                step="0.5"
                value={progressPercent}
                onChange={(event) => {
                  if (!current?.duration_ms) return;
                  const position = Math.round((Number(event.target.value) / 100) * current.duration_ms);
                  setData((existing) =>
                    existing
                      ? {
                          ...existing,
                          playback: { ...existing.playback, progress_ms: position },
                        }
                      : existing,
                  );
                }}
                onPointerUp={(event) => {
                  if (!current?.duration_ms) return;
                  const position = Math.round((Number((event.target as HTMLInputElement).value) / 100) * current.duration_ms);
                  void control("seek", undefined, { position_ms: position });
                }}
                className="w-full accent-emerald-500"
              />
              <span className="w-9">{formatDuration(current?.duration_ms)}</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3">
            <div className="hidden max-w-[260px] flex-1 xl:block">
              <select
                value={selectedOutput}
                onChange={(event) => {
                  const output = data.outputs.find((item) => item.spotify_device_id === event.target.value);
                  if (output?.available && output.spotify_device_id) void transfer(output.spotify_device_id);
                }}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-300"
              >
                <option value="">Current Spotify output</option>
                {data.outputs.map((output, index) => (
                  <option
                    key={output.spotify_device_id || `homehub-${output.homehub_device_id || index}`}
                    value={output.spotify_device_id || ""}
                    disabled={!output.available}
                  >
                    {output.homehub_device_id ? "HomeHub · " : ""}
                    {output.name}
                    {!output.available ? " — unavailable in Spotify Connect" : ""}
                  </option>
                ))}
              </select>
            </div>
            <Icon path={paths.mdiVolumeHigh} size={0.65} className="text-zinc-500" />
            <input
              type="range"
              min="0"
              max="100"
              value={data.playback.device?.volume_percent ?? 50}
              disabled={data.playback.device?.supports_volume === false}
              onChange={(event) =>
                setData((currentData) =>
                  currentData
                    ? {
                        ...currentData,
                        playback: {
                          ...currentData.playback,
                          device: currentData.playback.device
                            ? {
                                ...currentData.playback.device,
                                volume_percent: Number(event.target.value),
                              }
                            : currentData.playback.device,
                        },
                      }
                    : currentData,
                )
              }
              onPointerUp={(event) => void setVolume(Number((event.target as HTMLInputElement).value))}
              className="w-24 accent-emerald-500 disabled:opacity-30"
            />
            <button
              title="Refresh Spotify"
              onClick={() => void load().catch((reason: Error) => setError(reason.message))}
              className="text-zinc-500 hover:text-white"
            >
              <Icon path={paths.mdiRefresh} size={0.7} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MediaSection({
  title,
  subtitle,
  items,
  onPlay,
  onOpenShow,
  busy,
  large = false,
  empty = "Nothing here yet.",
}: {
  title: string;
  subtitle?: string;
  items: SpotifyMedia[];
  onPlay: (item: SpotifyMedia) => Promise<void>;
  onOpenShow: (item: SpotifyMedia) => Promise<void>;
  busy: string;
  large?: boolean;
  empty?: string;
}) {
  if (!items.length) {
    return (
      <section>
        <h2 className="text-xl font-bold">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
        <div className="mt-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 text-sm text-zinc-500">
          {empty}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-xl font-bold">{title}</h2>
      {subtitle && <p className="mt-1 max-w-4xl text-sm leading-6 text-zinc-500">{subtitle}</p>}
      <div className={`mt-4 grid gap-3 ${large ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" : "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6"}`}>
        {items.map((item, index) => (
          <article
            key={item.uri || item.id || `${item.name}-${index}`}
            className="group relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/60 p-3 transition hover:-translate-y-0.5 hover:border-zinc-700 hover:bg-zinc-900"
          >
            <button
              type="button"
              onClick={() =>
                item.type === "show" ? void onOpenShow(item) : void onPlay(item)
              }
              className="block w-full text-left"
            >
              <div className="relative aspect-square overflow-hidden rounded-xl bg-zinc-800">
                {item.image ? (
                  <img src={item.image} alt="" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-zinc-600">
                    <Icon path={mediaIcon(item.type)} size={1.7} />
                  </div>
                )}
                <span className="absolute bottom-2 right-2 rounded-full bg-emerald-500 p-2.5 text-black opacity-0 shadow-lg transition group-hover:opacity-100">
                  <Icon path={item.type === "show" ? paths.mdiFormatListBulleted : paths.mdiPlay} size={0.72} />
                </span>
              </div>
              <div className="mt-3 truncate text-sm font-semibold text-white">{item.name}</div>
              <div className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-zinc-500">
                {item.subtitle || item.description || item.type}
              </div>
            </button>
            {(item.type === "track" || item.type === "episode") && (
              <button
                type="button"
                disabled={busy === `queue:${item.uri}`}
                onClick={() => {
                  if (!item.uri) return;
                  void post("/spotify/control/", { action: "queue", uri: item.uri }).catch(() => undefined);
                }}
                title="Add to queue"
                className="absolute left-4 top-4 rounded-full bg-black/70 p-1.5 text-zinc-200 opacity-0 backdrop-blur transition group-hover:opacity-100"
              >
                <Icon path={paths.mdiPlaylistPlus} size={0.62} />
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
