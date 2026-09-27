class Syncer:
    def pull(self):
        raise NotImplementedError("TODO")  # expect-warn: hygiene/placeholder

    def push(self):
        # ok: a bare NotImplementedError is the usual way to mark an abstract method
        raise NotImplementedError
