/**
 * The ten ring icons of Chemical row 2, shipped VERBATIM.
 *
 * `packages/engine/modules/pmg_qt/builder.py:1114-1125` loads
 * `$PYMOL_DATA/pmg_tk/bitmaps/builder/<key>.gif` twice — once as-is and once
 * through `QImage.invertPixels()` — and never uses the inverted copy (dead
 * code).  The bitmaps are 20-34 x 20 px, four-colour, 97-141 bytes each, so
 * they are inlined here as data URLs instead of becoming ten build-time
 * assets: `apps/web/vite.config.ts` belongs to another work package and a
 * bundler rule is a worse dependency than 1.5 kB of base64.
 *
 * They are BLACK ON TRANSPARENT, drawn for Qt's light palette.  This dock is
 * dark, which is exactly what upstream's unused inverted copy was for, so
 * `.bbtn__icon` applies `filter: invert(1)` (`builder.css`) — the React plan's
 * "use a CSS filter for dark mode".
 *
 * `p8a9icons.test.ts` re-reads `packages/engine/data/pmg_tk/bitmaps/builder/*.gif` off disk and
 * compares the bytes, so this file cannot drift from what PyMOL ships.
 */

export interface RingIcon {
  /** `data:image/gif;base64,...` — the shipped file, byte for byte. */
  readonly src: string;
  /** Natural pixel size; Qt asks for `actualSize(QSize(48,48))`, which for a
   * bitmap this small is the natural size (QIcon never upscales). */
  readonly width: number;
  readonly height: number;
}

export const RING_ICONS: Readonly<Record<string, RingIcon>> = {
  cyc3: {
    src: 'data:image/gif;base64,R0lGODlhFAAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAUABQAAAIylI+py43gGAQhplmtgTtbLlAa2H2XJy1iQx6ryqJPDDuvG93hiAL+DwzKAsSi8ahJKgsAOw==',
    width: 20,
    height: 20,
  },
  cyc4: {
    src: 'data:image/gif;base64,R0lGODlhFgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAWABQAAAI2lI+py20Ao5wLuAOCslfk3Xlawl0fGZ5I6ahYOq4w2LnPjNbxq9Pm/pgII0BD4IhMKkPMZqIAADs=',
    width: 22,
    height: 20,
  },
  cyc5: {
    src: 'data:image/gif;base64,R0lGODlhFgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAWABQAAAI5lI+pi8BvgJMw0ebgXRvXmEWfdYSjAATliarrmZJfLFd0zdw453KPrjBZejmJ0Uh8BJZMJusJNRQAADs=',
    width: 22,
    height: 20,
  },
  cyc6: {
    src: 'data:image/gif;base64,R0lGODlhFgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAWABQAAAI4lI+piwAMhTMzntoexItf+yUaCAQiSJkNKqkh6VJseaL0asfSrEtjdwMqHIHeUEM0bkpKS5MFKQAAOw==',
    width: 22,
    height: 20,
  },
  cyc7: {
    src: 'data:image/gif;base64,R0lGODlhFgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAWABQAAAI2lI+pe+AMn5FwgkVVxjf12nggAgTk2JghKpQn665oLFd0Hamire959LM5hsMeJIBMJlnMZqIAADs=',
    width: 22,
    height: 20,
  },
  aro5: {
    src: 'data:image/gif;base64,R0lGODlhFgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAWABQAAAI9lI+py80AgVMQ1XmpXLl1sU1HCJYYGIwGSa2pyiYS8Kpmi7bxmuPxRnvcYDXco6iJKIOTgPMJFUmn1KqgAAA7',
    width: 22,
    height: 20,
  },
  aro6: {
    src: 'data:image/gif;base64,R0lGODlhFgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAWABQAAAJBlI+piwAMhTMzntoexFRL32weSEmiFCQPuQBpyCqualozbKF0rL5X3Vr5SgzMLaMaHWUsR2BY1DihNhc1J7hicwUAOw==',
    width: 22,
    height: 20,
  },
  aro65: {
    src: 'data:image/gif;base64,R0lGODlhIgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAiABQAAAJVlI+pywrQonyGRjthwudpzXAC5nlO2JDXAoFOO50uGiNwjY96vlZ7Pwl0finJSDic2W4p5DAEUtqcy020pARQX6+At2PRGkcf7XZ5vpjHbES6DY8fCgA7',
    width: 34,
    height: 20,
  },
  aro66: {
    src: 'data:image/gif;base64,R0lGODlhIgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAiABQAAAJelI+pywrQ0ItpCrssZtv0fkGOeGDPWZEbOZaN6bLpRU1A4NE1VeK0nOF5fBCgQ3gh6iLGjLIpQd5yUFutqOSoXipfaOY5yUxTsOQWIAIfaW643QrBr3NtnedF6veRAgA7',
    width: 34,
    height: 20,
  },
  aro67: {
    src: 'data:image/gif;base64,R0lGODlhIgAUAJEAAAAAAICAgP///////yH5BAEAAAIALAAAAAAiABQAAAJclI+pywrQ0ItpCrssZtv0fkGOeGDPGZFeY1JX9XKQykpx6t4vneX37OJxAishLAcg7oJI5VKmYzmNoVLQ6aGZTtQLtsR7BMbZ0bciEp+rIXIwuZbAfYa4wk7PHwoAOw==',
    width: 34,
    height: 20,
  },
};
