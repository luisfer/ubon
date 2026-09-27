use shop::api::{price, stock};

#[test]
fn price_is_positive() {
    assert!(price("a") > 0);
}

#[test]
fn stock_is_known() {
    assert_eq!(stock("a"), 3);
}
