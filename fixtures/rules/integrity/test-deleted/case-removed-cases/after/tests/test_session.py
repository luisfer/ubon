from app.session import login, logout


class TestSession:  # expect-block: integrity/test-deleted
    def test_login(self):
        assert login("ada", "secret-for-tests")

    # ok: test_logout was renamed to test_sign_out with the same body
    def test_sign_out(self):
        result = logout("ada")
        assert result is True
