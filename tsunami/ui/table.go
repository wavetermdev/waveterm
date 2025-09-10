package ui

import (
	"fmt"
	"reflect"
	"sort"
	"strconv"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Core table types
type CellContext[T any] struct {
	Data   T      `json:"row"`
	Value  any    `json:"value"`
	RowIdx int    `json:"rowIdx"`
	ColIdx int    `json:"colIdx"`
	Column string `json:"column"`
}

type RowContext[T any] struct {
	Data   T   `json:"row"`
	RowIdx int `json:"rowIdx"`
}

type HeaderContext struct {
	Column        string `json:"column"`
	IsSorted      bool   `json:"isSorted"`
	SortDirection string `json:"sortDirection"`
}

// Column definition - similar to TanStack Table
type TableColumn[T any] struct {
	AccessorKey     string                         `json:"accessorKey"` // Field name in the data
	AccessorFn      func(rowCtx RowContext[T]) any `json:"-"`           // Function to extract value from row
	Header          string                         `json:"header"`      // Display name
	Width           string                         `json:"width,omitempty"`
	Sortable        bool                           `json:"sortable"`
	CellClassName   string
	HeaderClassName string
	CellRender      func(ctx CellContext[T]) any `json:"-"` // Custom cell renderer
	HeaderRender    func(ctx HeaderContext) any  `json:"-"` // Custom header renderer
}

// Table props
type TableProps[T any] struct {
	Data              []T                                   `json:"data"`
	Columns           []TableColumn[T]                      `json:"columns"`
	RowRender         func(ctx RowContext[T]) any           `json:"-"` // Custom row renderer (overrides columns)
	RowClassName      func(ctx RowContext[T]) string        `json:"-"` // Custom row class names
	OnRowClick        func(row T, idx int)                  `json:"-"`
	OnSort            func(column string, direction string) `json:"-"`
	DefaultSort       string                                `json:"defaultSort,omitempty"`
	Pagination        *PaginationConfig                     `json:"pagination,omitempty"`
	Selectable        bool                                  `json:"selectable"`
	SelectedRows      []int                                 `json:"selectedRows,omitempty"`
	OnSelectionChange func(selectedRows []int)              `json:"-"`
}

type PaginationConfig struct {
	PageSize    int   `json:"pageSize"`
	CurrentPage int   `json:"currentPage"`
	ShowSizes   []int `json:"showSizes,omitempty"` // [10, 25, 50, 100]
}

// Helper to extract field value from struct/map using reflection
func getFieldValueWithReflection(item any, key string) any {
	if item == nil {
		return nil
	}

	// Handle map[string]any
	if m, ok := item.(map[string]any); ok {
		return m[key]
	}

	// Handle struct via reflection
	v := reflect.ValueOf(item)
	if v.Kind() == reflect.Ptr {
		v = v.Elem()
	}
	if v.Kind() != reflect.Struct {
		return nil
	}

	field := v.FieldByName(key)
	if !field.IsValid() {
		return nil
	}
	return field.Interface()
}

// Generic helper to extract field value using either AccessorFn or reflection
func getFieldValue[T any](row T, rowIdx int, col TableColumn[T]) any {
	if col.AccessorFn != nil {
		return col.AccessorFn(RowContext[T]{
			Data:   row,
			RowIdx: rowIdx,
		})
	}
	return getFieldValueWithReflection(row, col.AccessorKey)
}

// Helper to find column by accessor key
func findColumnByKey[T any](columns []TableColumn[T], key string) *TableColumn[T] {
	for _, col := range columns {
		if col.AccessorKey == key {
			return &col
		}
	}
	return nil
}

// Sort data by column
func sortData[T any](data []T, col TableColumn[T], direction string) []T {
	if len(data) == 0 || (col.AccessorKey == "" && col.AccessorFn == nil) {
		return data
	}

	sorted := make([]T, len(data))
	copy(sorted, data)

	sort.Slice(sorted, func(i, j int) bool {
		valI := getFieldValue(sorted[i], i, col)
		valJ := getFieldValue(sorted[j], j, col)

		// Handle nil values
		if valI == nil && valJ == nil {
			return false
		}
		if valI == nil {
			return direction == "asc"
		}
		if valJ == nil {
			return direction == "desc"
		}

		// Convert to strings for comparison (could be enhanced for numbers/dates)
		strI := fmt.Sprintf("%v", valI)
		strJ := fmt.Sprintf("%v", valJ)

		if direction == "asc" {
			return strI < strJ
		}
		return strI > strJ
	})

	return sorted
}

// Paginate data
func paginateData[T any](data []T, config *PaginationConfig) []T {
	if config == nil || len(data) == 0 {
		return data
	}

	start := config.CurrentPage * config.PageSize
	end := start + config.PageSize

	if start >= len(data) {
		return []T{}
	}
	if end > len(data) {
		end = len(data)
	}

	return data[start:end]
}

// Default cell renderer
func defaultCellRenderer[T any](ctx CellContext[T]) any {
	if ctx.Value == nil {
		return vdom.H("span", map[string]any{
			"className": "text-gray-500",
		}, "-")
	}

	return vdom.H("span", nil, fmt.Sprintf("%v", ctx.Value))
}

// Default header renderer
func defaultHeaderRenderer(ctx HeaderContext) any {
	return vdom.H("div", map[string]any{
		"className": "flex items-center gap-2",
	},
		vdom.H("span", nil, ctx.Column),
		vdom.If(ctx.IsSorted,
			vdom.H("span", map[string]any{
				"className": "text-blue-400",
			}, vdom.IfElse(ctx.SortDirection == "asc", "↑", "↓")),
		),
	)
}

// Helper function to safely call RowClassName function
func makeRowClassName[T any](rowClassNameFunc func(ctx RowContext[T]) string, rowCtx RowContext[T]) string {
	if rowClassNameFunc == nil {
		return ""
	}
	return rowClassNameFunc(rowCtx)
}

func MakeTableComponent[T any](componentName string) vdom.Component[TableProps[T]] {
	return app.DefineComponent(componentName, genTableRenderFunc[T])
}

func genTableRenderFunc[T any](props TableProps[T]) any {
	// State for sorting
	sortColumnAtom := app.UseLocal(props.DefaultSort)
	sortDirectionAtom := app.UseLocal("asc")

	// State for pagination - initialize with prop values
	initialPage := 0
	initialPageSize := 25
	if props.Pagination != nil {
		initialPage = props.Pagination.CurrentPage
		initialPageSize = props.Pagination.PageSize
	}
	currentPageAtom := app.UseLocal(initialPage)
	pageSizeAtom := app.UseLocal(initialPageSize)

	// State for selection - initialize with empty slice if nil
	initialSelection := props.SelectedRows
	if initialSelection == nil {
		initialSelection = []int{}
	}
	selectedRowsAtom := app.UseLocal(initialSelection)


	// Handle sorting
	handleSort := func(column string) {
		currentSort := sortColumnAtom.Get()
		currentDir := sortDirectionAtom.Get()

		if currentSort == column {
			// Toggle direction
			newDir := vdom.IfElse(currentDir == "asc", "desc", "asc").(string)
			sortDirectionAtom.Set(newDir)
			if props.OnSort != nil {
				props.OnSort(column, newDir)
			}
		} else {
			// New column
			sortColumnAtom.Set(column)
			sortDirectionAtom.Set("asc")
			if props.OnSort != nil {
				props.OnSort(column, "asc")
			}
		}
	}

	// Handle row selection
	handleRowSelect := func(rowIdx int) {
		if !props.Selectable {
			return
		}

		selectedRowsAtom.SetFn(func(current []int) []int {
			// Toggle selection
			for i, idx := range current {
				if idx == rowIdx {
					// Remove
					return append(current[:i], current[i+1:]...)
				}
			}
			// Add
			return append(current, rowIdx)
		})

		if props.OnSelectionChange != nil {
			props.OnSelectionChange(selectedRowsAtom.Get())
		}
	}

	// Handle pagination
	handlePageChange := func(page int) {
		currentPageAtom.Set(page)
	}

	handlePageSizeChange := func(size int) {
		pageSizeAtom.Set(size)
		currentPageAtom.Set(0) // Reset to first page
	}

	// Process data
	processedData := props.Data
	if sortColumnAtom.Get() != "" {
		if sortCol := findColumnByKey(props.Columns, sortColumnAtom.Get()); sortCol != nil {
			processedData = sortData(processedData, *sortCol, sortDirectionAtom.Get())
		}
	}

	totalRows := len(processedData)

	// Apply pagination
	paginationConfig := &PaginationConfig{
		PageSize:    pageSizeAtom.Get(),
		CurrentPage: currentPageAtom.Get(),
	}

	paginatedData := paginateData(processedData, paginationConfig)

	// Get current state values
	currentSort := sortColumnAtom.Get()
	currentDir := sortDirectionAtom.Get()
	currentSelected := selectedRowsAtom.Get()

	return vdom.H("div", map[string]any{
		"className": "w-full",
	},
		// Table
		vdom.H("div", map[string]any{
			"className": "overflow-auto border border-gray-600 rounded-lg",
		},
			vdom.H("table", map[string]any{
				"className": "w-full bg-gray-900 text-white",
			},
				// Header
				vdom.H("thead", map[string]any{
					"className": "bg-gray-800 border-b border-gray-600",
				},
					vdom.H("tr", nil,
						vdom.If(props.Selectable,
							vdom.H("th", map[string]any{
								"className": "p-3 text-left",
								"style":     map[string]any{"width": "40px"},
							},
								vdom.H("input", map[string]any{
									"type":    "checkbox",
									"checked": len(currentSelected) == len(paginatedData) && len(paginatedData) > 0,
									"onChange": func() {
										if len(currentSelected) == len(paginatedData) {
											selectedRowsAtom.Set([]int{})
										} else {
											allSelected := make([]int, len(paginatedData))
											for i := range paginatedData {
												allSelected[i] = i
											}
											selectedRowsAtom.Set(allSelected)
										}
									},
								}),
							),
						),
						vdom.ForEach(props.Columns, func(col TableColumn[T], colIdx int) any {
							isSorted := currentSort == col.AccessorKey

							headerCtx := HeaderContext{
								Column:        col.Header,
								IsSorted:      isSorted,
								SortDirection: currentDir,
							}

							headerContent := defaultHeaderRenderer(headerCtx)
							if col.HeaderRender != nil {
								headerContent = col.HeaderRender(headerCtx)
							}

							return vdom.H("th", map[string]any{
								"key": col.AccessorKey,
								"className": vdom.Classes(
									"p-3 text-left font-semibold",
									vdom.If(col.Sortable, "cursor-pointer hover:bg-gray-700"),
									col.HeaderClassName,
								),
								"style":   vdom.If(col.Width != "", map[string]any{"width": col.Width}),
								"onClick": vdom.If(col.Sortable, func() { handleSort(col.AccessorKey) }),
							}, headerContent)
						}),
					),
				),

				// Body
				vdom.H("tbody", map[string]any{
					"className": "divide-y divide-gray-700",
				},
					vdom.ForEach(paginatedData, func(row T, rowIdx int) any {
						isSelected := func() bool {
							for _, idx := range currentSelected {
								if idx == rowIdx {
									return true
								}
							}
							return false
						}()

						// Custom row renderer
						if props.RowRender != nil {
							return props.RowRender(RowContext[T]{
								Data:   row,
								RowIdx: rowIdx,
							})
						}

						// Default row rendering with columns
						rowCtx := RowContext[T]{
							Data:   row,
							RowIdx: rowIdx,
						}

						return vdom.H("tr", map[string]any{
							"key": rowIdx,
							"className": vdom.Classes(
								"hover:bg-gray-800 transition-colors",
								vdom.If(isSelected, "bg-blue-900"),
								vdom.If(props.OnRowClick != nil, "cursor-pointer"),
								makeRowClassName(props.RowClassName, rowCtx),
							),
							"onClick": func() {
								if props.OnRowClick != nil {
									props.OnRowClick(row, rowIdx)
								}
							},
						},
							vdom.If(props.Selectable,
								vdom.H("td", map[string]any{
									"className": "p-3",
								},
									vdom.H("input", map[string]any{
										"type":     "checkbox",
										"checked":  isSelected,
										"onChange": func() { handleRowSelect(rowIdx) },
									}),
								),
							),
							vdom.ForEach(props.Columns, func(col TableColumn[T], colIdx int) any {
								var value any
								value = getFieldValue(row, rowIdx, col)
								cellCtx := CellContext[T]{
									Data:   row,
									Value:  value,
									RowIdx: rowIdx,
									ColIdx: colIdx,
									Column: col.AccessorKey,
								}

								cellContent := defaultCellRenderer(cellCtx)
								if col.CellRender != nil {
									cellContent = col.CellRender(cellCtx)
								}

								return vdom.H("td", map[string]any{
									"key":       col.AccessorKey,
									"className": vdom.Classes("p-3", col.CellClassName),
								}, cellContent)
							}),
						)
					}),
				),
			),
		),

		// Pagination
		vdom.If(props.Pagination != nil,
			renderPagination(totalRows, paginationConfig, handlePageChange, handlePageSizeChange),
		),
	)
}

// Pagination component
func renderPagination(totalRows int, config *PaginationConfig, onPageChange func(int), onPageSizeChange func(int)) any {
	totalPages := (totalRows + config.PageSize - 1) / config.PageSize
	currentPage := config.CurrentPage

	return vdom.H("div", map[string]any{
		"className": "flex items-center justify-between mt-4 px-4 py-3 bg-gray-800 rounded-lg",
	},
		// Page size selector
		vdom.H("div", map[string]any{
			"className": "flex items-center gap-2",
		},
			vdom.H("span", map[string]any{
				"className": "text-sm text-gray-400",
			}, "Show"),
			vdom.H("select", map[string]any{
				"className": "bg-gray-700 text-white rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-gray-600 mx-1",
				"value":     strconv.Itoa(config.PageSize),
				"onChange": func(e vdom.VDomEvent) {
					if size, err := strconv.Atoi(e.TargetValue); err == nil {
						onPageSizeChange(size)
					}
				},
			},
				vdom.H("option", map[string]any{"value": "10"}, "10"),
				vdom.H("option", map[string]any{"value": "25"}, "25"),
				vdom.H("option", map[string]any{"value": "50"}, "50"),
				vdom.H("option", map[string]any{"value": "100"}, "100"),
			),
			vdom.H("span", map[string]any{
				"className": "text-sm text-gray-400",
			}, "entries"),
		),

		// Page info
		vdom.H("span", map[string]any{
			"className": "text-sm text-gray-400",
		}, fmt.Sprintf("Showing %d-%d of %d",
			currentPage*config.PageSize+1,
			vdom.Ternary(currentPage*config.PageSize+config.PageSize > totalRows,
				totalRows,
				currentPage*config.PageSize+config.PageSize),
			totalRows,
		)),

		// Page controls
		vdom.H("div", map[string]any{
			"className": "flex items-center gap-3",
		},
			vdom.H("button", map[string]any{
				"className": vdom.Classes(
					"px-3 py-1.5 rounded text-sm transition-colors",
					vdom.IfElse(currentPage > 0,
						"bg-blue-600 hover:bg-blue-700 text-white cursor-pointer",
						"bg-gray-600 text-gray-500 cursor-not-allowed"),
				),
				"disabled": currentPage <= 0,
				"onClick": func() {
					if currentPage > 0 {
						onPageChange(currentPage - 1)
					}
				},
			}, "Previous"),

			vdom.H("span", map[string]any{
				"className": "text-sm text-gray-400 px-2",
			}, fmt.Sprintf("Page %d of %d", currentPage+1, totalPages)),

			vdom.H("button", map[string]any{
				"className": vdom.Classes(
					"px-3 py-1.5 rounded text-sm transition-colors",
					vdom.IfElse(currentPage < totalPages-1,
						"bg-blue-600 hover:bg-blue-700 text-white cursor-pointer",
						"bg-gray-600 text-gray-500 cursor-not-allowed"),
				),
				"disabled": currentPage >= totalPages-1,
				"onClick": func() {
					if currentPage < totalPages-1 {
						onPageChange(currentPage + 1)
					}
				},
			}, "Next"),
		),
	)
}
