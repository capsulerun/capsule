"""
Capsule Selectors Shim

Replaces the selectors module to enable asyncio to work in WASM.
"""

import collections

EVENT_READ = 1
EVENT_WRITE = 4

SelectorKey = collections.namedtuple("SelectorKey", ["fileobj", "fd", "events", "data"])


class CapsuleSelector:
    """
    Selector that reports SocketShim objects as immediately ready.
    """

    def __init__(self):
        self._keys = {}
        self._fd_counter = 0

    def register(self, fileobj, events, data=None):
        if fileobj in self._keys:
            raise KeyError(f"{fileobj!r} is already registered")
        self._fd_counter += 1
        key = SelectorKey(fileobj=fileobj, fd=self._fd_counter, events=events, data=data)
        self._keys[fileobj] = key
        return key

    def unregister(self, fileobj):
        key = self._keys.pop(fileobj, None)
        if key is None:
            raise KeyError(f"{fileobj!r} is not registered")
        return key

    def modify(self, fileobj, events, data=None):
        key = self._keys.get(fileobj)
        if key is None:
            raise KeyError(f"{fileobj!r} is not registered")
        new_key = SelectorKey(fileobj=key.fileobj, fd=key.fd, events=events, data=data)
        self._keys[fileobj] = new_key
        return new_key

    def select(self, timeout=None):
        from capsule.socket import SocketShim

        ready = []
        for fileobj, key in list(self._keys.items()):
            if isinstance(fileobj, SocketShim):
                events = _ready_events(fileobj, key.events)
                if events:
                    ready.append((key, events))
        return ready

    def get_key(self, fileobj):
        key = self._keys.get(fileobj)
        if key is None:
            raise KeyError(f"{fileobj!r} is not registered")
        return key

    def get_map(self):
        return dict(self._keys)

    def close(self):
        self._keys.clear()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def _ready_events(sock, registered_events):
    """Return which events are immediately ready for a SocketShim."""
    ready = 0
    if registered_events & EVENT_WRITE:
        ready |= EVENT_WRITE
    if registered_events & EVENT_READ and (sock._send_buffer or sock._recv_buffer):
        ready |= EVENT_READ
    return ready

DefaultSelector = CapsuleSelector
