import sys

import pytest

from shop.orders import refund, total


@pytest.mark.skip(reason="flaky")  # expect-block: integrity/test-skipped
def test_total():
    assert total([1, 2]) == 3


def test_refund():
    pytest.skip("payment sandbox is down")  # expect-block: integrity/test-skipped
    assert refund(10) == -10


# ok: skipif with a real condition existed at the base
@pytest.mark.skipif(sys.platform == "win32", reason="POSIX paths only")
def test_paths():
    assert "/".join(["a", "b"]) == "a/b"


def test_optional_dependency():
    # ok: importorskip skips only when the optional package is missing
    np = pytest.importorskip("numpy")
    assert np


def test_linux_only():
    if sys.platform != "linux":
        # ok: pytest.skip inside a condition
        pytest.skip("linux only")
    assert True


@pytest.mark.xfail(reason="rounding bug 123")  # expect-block: integrity/test-skipped
def test_known_bug():
    assert total([0.1, 0.2]) == 0.3


# ok: a strict xfail fails the run as soon as the test starts passing
@pytest.mark.xfail(strict=True, reason="bug 456")
def test_strict_bug():
    assert total([]) == 0


def test_docstring_mentions_skip():
    """ok: a docstring that says @pytest.mark.skip is not a decorator."""
    assert True
