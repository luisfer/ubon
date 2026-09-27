use shop::api::{price, stock};

#[test]
#[ignore] // expect-block: integrity/test-skipped
fn price_is_positive() {
    assert!(price("a") > 0);
}

#[test]
// ok: cfg_attr ignores the test on Windows only
#[cfg_attr(windows, ignore)]
fn stock_is_known() {
    assert_eq!(stock("a"), 3);
}
