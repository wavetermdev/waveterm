{{ range . }}
## {{ .Name }}

* Name: {{ .Name }}
* Version: {{ .Version }}
* License: [{{ .LicenseName }}]({{ .LicenseURL }})

```
{{ .LicenseText }}
```
-----
{{ end }}
