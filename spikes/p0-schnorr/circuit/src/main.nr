// P0 spike: verify a TS-produced (bb.js new-scheme) Schnorr signature in-circuit.
use std::embedded_curve_ops::{EmbeddedCurvePoint, EmbeddedCurveScalar};

fn main(
    pub_key_x: pub Field,
    pub_key_y: pub Field,
    sig_s_lo: Field,
    sig_s_hi: Field,
    sig_e_lo: Field,
    sig_e_hi: Field,
    message: pub Field,
) {
    let pub_key = EmbeddedCurvePoint { x: pub_key_x, y: pub_key_y };
    let s = EmbeddedCurveScalar { lo: sig_s_lo, hi: sig_s_hi };
    let e = EmbeddedCurveScalar { lo: sig_e_lo, hi: sig_e_hi };
    schnorr::assert_valid_signature(pub_key, (s, e), message);
}
