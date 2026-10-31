using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CampusBalance.Core;

namespace CampusBalance.App;

[System.Runtime.Versioning.SupportedOSPlatform("windows")]
internal sealed class CredentialStore(string directory) : ICredentialStore
{
    private string FilePath => Path.Combine(directory, "login.dpapi");
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("CampusBalance.Windows.v1");
    public SavedLogin? Read()
    {
        if (!File.Exists(FilePath)) return null;
        var bytes = ProtectedData.Unprotect(File.ReadAllBytes(FilePath), Entropy, DataProtectionScope.CurrentUser);
        try { return JsonSerializer.Deserialize<SavedLogin>(bytes); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public void Save(SavedLogin login)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(login);
        try
        {
            var encrypted = ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser);
            // Only DPAPI ciphertext reaches disk; plaintext is cleared below.
            var file = FilePath;
            Directory.CreateDirectory(directory);
            var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try { File.WriteAllBytes(temporary, encrypted); File.Move(temporary, file, true); }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
        finally { CryptographicOperations.ZeroMemory(bytes); }
    }
    public void Clear() => File.Delete(FilePath);
}
