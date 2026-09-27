import sys

import pytest

from shop.orders import refund, total


def test_total():
    assert total([1, 2]) == 3


def test_refund():
    assert refund(10) == -10


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX paths only")
def test_paths():
    assert "/".join(["a", "b"]) == "a/b"


def test_known_bug():
    assert total([0.1, 0.2]) == 0.3


def test_strict_bug():
    assert total([]) == 0
