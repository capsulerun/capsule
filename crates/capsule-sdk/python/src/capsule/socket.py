"""
Capsule Socket Shim

This module provides a socket-compatible interface that routes HTTP/HTTPS
traffic through http-request host function.
"""

import io
import sys
from typing import Optional, Tuple

_original_socket = None
_installed = False


class HTTPParseError(Exception):
    """Raised when HTTP parsing fails."""
    pass


class SocketShim:
    """
    A socket-like object that intercepts HTTP/HTTPS traffic and routes it
    through http-request host function.
    """

    AF_INET = 2
    AF_INET6 = 10
    SOCK_STREAM = 1
    SOCK_DGRAM = 2
    SOL_SOCKET = 1
    SO_REUSEADDR = 2
    IPPROTO_TCP = 6

    def __init__(self, family=2, type=1, proto=0, _peer=None):
        self.family = family
        self.type = type
        self.proto = proto
        self._host = None
        self._port = None
        self._is_ssl = False
        self._timeout = None
        self._send_buffer = bytearray()
        self._recv_buffer = bytearray()
        self._closed = False
        self._peer: Optional['SocketShim'] = _peer

    def connect(self, address: Tuple[str, int]):
        """Connect to a remote host."""
        if self._closed:
            raise OSError("Bad file descriptor")
        self._host, self._port = address
        self._is_ssl = self._port == 443

    def connect_ex(self, address: Tuple[str, int]) -> int:
        """Non-blocking connect used by asyncio. Returns 0 on immediate success."""
        self.connect(address)
        return 0

    def fileno(self) -> int:
        return -1

    def send(self, data: bytes) -> int:
        """Send data to the socket (buffer for HTTP request building)."""
        if self._closed:
            raise OSError("Bad file descriptor")
        if self._peer is not None:
            self._peer._recv_buffer.extend(data)
        else:
            self._send_buffer.extend(data)
        return len(data)

    def sendall(self, data: bytes):
        """Send all data to the socket."""
        self.send(data)

    def recv(self, bufsize: int) -> bytes:
        """Receive data from the socket."""
        if self._closed:
            return b""

        if not self._recv_buffer and self._send_buffer:
            self._execute_http_request()

        if len(self._recv_buffer) >= bufsize:
            result = bytes(self._recv_buffer[:bufsize])
            self._recv_buffer = self._recv_buffer[bufsize:]
            return result
        else:
            result = bytes(self._recv_buffer)
            self._recv_buffer.clear()
            return result

    def recv_into(self, buffer, nbytes=0):
        """Receive data into a buffer."""
        nbytes = nbytes or len(buffer)
        data = self.recv(nbytes)
        n = len(data)
        buffer[:n] = data
        return n

    def settimeout(self, timeout: Optional[float]):
        """Set socket timeout."""
        self._timeout = timeout

    def gettimeout(self) -> Optional[float]:
        """Get socket timeout."""
        return self._timeout

    def setblocking(self, flag: bool):
        """Set blocking mode."""
        if flag:
            self._timeout = None
        else:
            self._timeout = 0.0

    def setsockopt(self, level, optname, value):
        """Set socket option (no-op for HTTP shim)."""
        pass

    def getsockopt(self, level, optname):
        """Get socket option."""
        return 0

    def shutdown(self, how):
        pass

    def close(self):
        """Close the socket."""
        self._closed = True
        self._send_buffer.clear()
        self._recv_buffer.clear()

    def makefile(self, mode='r', buffering=None, *args, **kwargs):
        """Create a file-like object from the socket, matching real socket.makefile() behaviour."""
        raw = _SocketBytesIO(self)
        if 'b' in mode:
            return io.BufferedReader(raw)
        return io.TextIOWrapper(io.BufferedReader(raw))

    def _execute_http_request(self):
        """Parse the buffered HTTP request and execute it via Capsule's http-request."""
        try:
            request_str = self._send_buffer.decode('utf-8', errors='replace')
            method, url, headers_dict, body = self._parse_http_request(request_str)

            # Remove Accept-Encoding so the Rust host fetches plain text.
            # The host always returns a decoded body; keeping this header would
            # return compressed bytes that the client would try to decompress again.
            headers_dict.pop('Accept-Encoding', None)
            headers_dict.pop('accept-encoding', None)

            from capsule.http import _make_request

            response = _make_request(method, url, headers_dict, body)

            http_response = self._build_http_response(response)
            self._recv_buffer.extend(http_response.encode('utf-8'))

        except Exception as e:
            error_response = (
                "HTTP/1.1 500 Internal Server Error\r\n"
                "Content-Type: text/plain\r\n"
                f"Content-Length: {len(str(e))}\r\n"
                "\r\n"
                f"{str(e)}"
            )
            self._recv_buffer.extend(error_response.encode('utf-8'))

    def _parse_http_request(self, request_str: str) -> Tuple[str, str, dict, Optional[str]]:
        """Parse HTTP request string into components."""
        lines = request_str.split('\r\n')
        if not lines:
            raise HTTPParseError("Empty request")

        request_line = lines[0]
        parts = request_line.split(' ')
        if len(parts) < 2:
            raise HTTPParseError(f"Invalid request line: {request_line}")

        method = parts[0].upper()
        path = parts[1]

        scheme = 'https' if self._is_ssl else 'http'
        default_port = 443 if self._is_ssl else 80
        if self._port and self._port != default_port:
            url = f"{scheme}://{self._host}:{self._port}{path}"
        else:
            url = f"{scheme}://{self._host}{path}"

        headers_dict = {}
        body_start_idx = 0
        for i, line in enumerate(lines[1:], 1):
            if not line:
                body_start_idx = i + 1
                break
            if ':' in line:
                key, value = line.split(':', 1)
                headers_dict[key.strip()] = value.strip()

        body = None
        if body_start_idx < len(lines):
            body_lines = lines[body_start_idx:]
            body = '\r\n'.join(body_lines)
            if body:
                body = body.rstrip('\r\n')

        return method, url, headers_dict, body

    def _build_http_response(self, response) -> str:
        """Build HTTP response string from Capsule Response object."""
        status_line = f"HTTP/1.1 {response.status_code} OK\r\n"

        skip_headers = {'content-encoding', 'transfer-encoding'}

        headers_lines = []
        for key, value in response.headers.items():
            if key.lower() not in skip_headers:
                headers_lines.append(f"{key}: {value}\r\n")

        body_bytes = response.text.encode('utf-8')
        headers_lines.append(f"Content-Length: {len(body_bytes)}\r\n")

        response_str = status_line
        response_str += ''.join(headers_lines)
        response_str += "\r\n"
        response_str += response.text

        return response_str

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class _SocketBytesIO(io.RawIOBase):
    """File-like bytes interface for socket."""

    def __init__(self, sock):
        self._sock = sock

    def readable(self):
        return True

    def writable(self):
        return True

    def read(self, size=-1):
        if size == -1:
            # Read all available
            result = bytearray()
            while True:
                chunk = self._sock.recv(8192)
                if not chunk:
                    break
                result.extend(chunk)
            return bytes(result)
        return self._sock.recv(size)

    def readinto(self, b):
        data = self._sock.recv(len(b))
        n = len(data)
        b[:n] = data
        return n

    def write(self, b):
        return self._sock.send(b)


class SSLContext:
    """SSLContext shim — SSL is handled by the Rust host, all setup is no-op."""

    PROTOCOL_TLS = 2
    PROTOCOL_TLS_CLIENT = 16
    PROTOCOL_TLS_SERVER = 17

    def __init__(self, protocol=None):
        self.protocol = protocol
        # Attributes read/written by urllib and http.client
        self.check_hostname = True
        self.verify_mode = 2        # ssl.CERT_REQUIRED
        self.post_handshake_auth = False
        self.options = 0
        self.verify_flags = 0
        self.minimum_version = None
        self.maximum_version = None
        self.keylog_filename = None
        self.sni_callback = None

    def wrap_socket(self, sock, server_hostname=None, **kwargs):
        sock._is_ssl = True
        if server_hostname:
            sock._host = server_hostname
        return sock

    # All setup methods are no-ops — the Rust host handles actual TLS
    def load_cert_chain(self, *args, **kwargs): pass
    def load_default_certs(self, *args, **kwargs): pass
    def load_dh_params(self, *args, **kwargs): pass
    def load_verify_locations(self, *args, **kwargs): pass
    def set_alpn_protocols(self, protocols): pass
    def set_ciphers(self, ciphers): pass
    def set_default_verify_paths(self): pass
    def set_ecdh_curve(self, curve_name): pass
    def set_npn_protocols(self, protocols): pass
    def set_servername_callback(self, callback): pass
    def set_psk_client_callback(self, callback): pass
    def set_psk_server_callback(self, callback): pass
    def get_ca_certs(self, *args, **kwargs): return []
    def get_ciphers(self): return []
    def cert_store_stats(self): return {}
    def session_stats(self): return {}


def socket(family=2, type=1, proto=0):
    """Create a new socket."""
    return SocketShim(family, type, proto)


def create_connection(address, timeout=None, source_address=None):
    """Create a socket connection to address."""
    sock = SocketShim()
    if timeout is not None:
        sock.settimeout(timeout)
    sock.connect(address)
    return sock


def socketpair(family=SocketShim.AF_INET, type=SocketShim.SOCK_STREAM, proto=0):
    """Return two connected sockets. Used by asyncio for its internal self-pipe."""
    a = SocketShim(family, type, proto)
    b = SocketShim(family, type, proto)
    a._peer = b
    b._peer = a
    return a, b


def getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    """Get address info (simplified for HTTP/HTTPS)."""
    # Return a minimal valid response
    family = family or SocketShim.AF_INET
    type = type or SocketShim.SOCK_STREAM
    return [(family, type, proto, '', (host, port))]


def gethostbyname(hostname):
    """Get host by name (return hostname as-is)."""
    return hostname


def gethostname():
    """Get hostname."""
    return 'capsule-wasm'


def getdefaulttimeout() -> Optional[float]:
    return None


def setdefaulttimeout(timeout: Optional[float]):
    pass


_GLOBAL_DEFAULT_TIMEOUT = object()

AF_INET = SocketShim.AF_INET
AF_INET6 = SocketShim.AF_INET6
SOCK_STREAM = SocketShim.SOCK_STREAM
SOCK_DGRAM = SocketShim.SOCK_DGRAM
SOL_SOCKET = SocketShim.SOL_SOCKET
SO_REUSEADDR = SocketShim.SO_REUSEADDR
IPPROTO_TCP = SocketShim.IPPROTO_TCP
TCP_NODELAY = 1
SCM_RIGHTS = 1
SHUT_RDWR = 2
SHUT_RD = 0
SHUT_WR = 1
has_dualstack_ipv6 = False
has_ipv6 = False

error = OSError
timeout = OSError
gaierror = OSError
herror = OSError

class SSLError(OSError): pass
class SSLWantReadError(SSLError): pass
class SSLWantWriteError(SSLError): pass
SSL_ERROR_WANT_READ = 2

class SSLSocket: pass

class MemoryBIO:
    def __init__(self): self.eof = False
    def read(self, n=-1): return b""
    def write(self, b): return len(b)
    @property
    def pending(self): return 0


def _install():
    """Install the socket, selectors, and ssl shims. Called by the bootloader."""
    global _original_socket, _installed

    if _installed:
        return

    if 'socket' in sys.modules:
        _original_socket = sys.modules['socket']

    import types
    import capsule.socket as _self
    import capsule.selectors as _selectors

    sys.modules['socket'] = _self
    sys.modules['selectors'] = _selectors

    ssl_module = types.ModuleType('ssl')
    ssl_module.SSLContext = SSLContext
    ssl_module.PROTOCOL_TLS = SSLContext.PROTOCOL_TLS
    ssl_module.PROTOCOL_TLS_CLIENT = SSLContext.PROTOCOL_TLS_CLIENT
    ssl_module.create_default_context = lambda *args, **kwargs: SSLContext()
    ssl_module._create_default_https_context = lambda *args, **kwargs: SSLContext()
    ssl_module.SSLError = SSLError
    ssl_module.SSLWantReadError = SSLWantReadError
    ssl_module.SSLWantWriteError = SSLWantWriteError
    ssl_module.SSL_ERROR_WANT_READ = SSL_ERROR_WANT_READ
    ssl_module.SSL_ERROR_WANT_WRITE = 3
    ssl_module.SSL_ERROR_EOF = 8
    ssl_module.SSLSocket = SSLSocket
    ssl_module.MemoryBIO = MemoryBIO

    ssl_module.OPENSSL_VERSION = "OpenSSL 3.0.0 (Capsule WASM stub)"
    ssl_module.OPENSSL_VERSION_INFO = (3, 0, 0, 0, 0)
    ssl_module.OPENSSL_VERSION_NUMBER = 0x30000000
    ssl_module.HAS_NEVER_CHECK_COMMON_NAME = True
    ssl_module.CERT_NONE = 0
    ssl_module.CERT_OPTIONAL = 1
    ssl_module.CERT_REQUIRED = 2

    class VerifyMode:
        CERT_NONE = 0
        CERT_OPTIONAL = 1
        CERT_REQUIRED = 2

    ssl_module.VerifyMode = VerifyMode

    class TLSVersion:
        MINIMUM_SUPPORTED = 0
        TLSv1 = 1
        TLSv1_1 = 2
        TLSv1_2 = 3
        TLSv1_3 = 4
        MAXIMUM_SUPPORTED = 4

    ssl_module.TLSVersion = TLSVersion

    ssl_module.OP_NO_SSLv2 = 0
    ssl_module.OP_NO_SSLv3 = 0
    ssl_module.OP_NO_TICKET = 0
    ssl_module.OP_NO_COMPRESSION = 0
    ssl_module.PROTOCOL_TLSv1 = 3
    ssl_module.PROTOCOL_TLSv1_1 = 4
    ssl_module.PROTOCOL_TLSv1_2 = 5
    ssl_module.VERIFY_X509_STRICT = 0
    ssl_module.VERIFY_X509_PARTIAL_CHAIN = 0
    ssl_module.VERIFY_X509_TRUSTED_FIRST = 0

    sys.modules['ssl'] = ssl_module

    _installed = True


def _uninstall():
    """Uninstall the shims, restoring original modules. Useful for testing."""
    global _original_socket, _installed

    if not _installed:
        return

    if _original_socket is not None:
        sys.modules['socket'] = _original_socket
    elif 'socket' in sys.modules:
        del sys.modules['socket']

    if 'selectors' in sys.modules:
        del sys.modules['selectors']

    if 'ssl' in sys.modules:
        del sys.modules['ssl']

    _installed = False
    _original_socket = None
