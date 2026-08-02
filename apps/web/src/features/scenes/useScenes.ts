/**
 * Scene bin state: the list, the thumbnails, and every write.
 *
 * `scenes_changed` is setting **254** (`packages/engine/layer1/SettingInfo.h:339`) and rides
 * the settings drain, so plan §1.5 says no new event is needed — the bridge
 * re-reads `cmd.get_scene_list()` (0.7 us) when it appears. Until WP-15 lands
 * that drain, this hook refreshes after every write and on a slow tick, which
 * is the same information one poll later. It never polls at viewport rates:
 * the scene bin changes when the user changes it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScenePanelPayload, SceneThumbnail } from '@tenmol/protocol/topics/movie';
import { useSession } from '../../app';
import { createMovieSource, type MovieSource } from '../movie/movieSource';
import type { SceneAction } from './sceneActions';

const REFRESH_MS = 1500;

const EMPTY: ScenePanelPayload = { scenes: [], current: null, order: [] };

export interface ScenesController {
  payload: ScenePanelPayload;
  thumbs: Record<string, SceneThumbnail>;
  source: MovieSource;
  run(action: SceneAction): Promise<void>;
  refresh(): Promise<void>;
  loadThumb(name: string): Promise<void>;
}

export function useScenes(): ScenesController {
  const session = useSession();
  const sourceRef = useRef<MovieSource | null>(null);
  sourceRef.current ??= createMovieSource(session.call);
  const source = sourceRef.current;

  const [payload, setPayload] = useState<ScenePanelPayload>(EMPTY);
  const [thumbs, setThumbs] = useState<Record<string, SceneThumbnail>>({});
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const next = await source.scenes();
    if (alive.current) setPayload(next);
  }, [source]);

  const loadThumb = useCallback(
    async (name: string) => {
      const thumb = await source.thumbnail(name);
      // `ready === false` means the deferred capture has not landed yet
      // (MovieScene.cpp:225-232) — keep whatever we had rather than replacing a
      // good image with a black one.
      if (thumb && thumb.ready && alive.current) {
        setThumbs((current) => ({ ...current, [name]: thumb }));
      }
    },
    [source],
  );

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  const run = useCallback(
    async (action: SceneAction) => {
      await session.act({
        fn: action.fn,
        args: action.args,
        kwargs: action.kwargs ?? {},
        echo: action.echo,
        invalidatesNames: true,
      });
      await refresh();
    },
    [session, refresh],
  );

  return { payload, thumbs, source, run, refresh, loadThumb };
}
