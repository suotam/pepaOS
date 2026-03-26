import proj4 from 'proj4'

const S_JTSK =
  '+proj=krovak +lat_0=49.5 +lon_0=24.83333333333333 +alpha=30.28813975277778 +k=0.9999 +x_0=0 +y_0=0 +ellps=bessel +towgs84=589,76,480,0,0,0,0 +units=m +no_defs'

const samples: Array<[string, number, number]> = [
  ['sample', 1166540.03, 515561.05],
]

for (const [name, x, y] of samples) {
  const variants = {
    xy: proj4(S_JTSK, proj4.WGS84, [x, y]),
    yx: proj4(S_JTSK, proj4.WGS84, [y, x]),
    neg_xy: proj4(S_JTSK, proj4.WGS84, [-x, -y]),
    neg_yx: proj4(S_JTSK, proj4.WGS84, [-y, -x]),
  }

  console.log(name, variants)
}
