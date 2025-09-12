package main

import (
	"fmt"

	"github.com/wavetermdev/waveterm/tsunami/app"
	"github.com/wavetermdev/waveterm/tsunami/ui"
	"github.com/wavetermdev/waveterm/tsunami/vdom"
)

// Sample data structure for the table
type Person struct {
	Name  string `json:"name"`
	Age   int    `json:"age"`
	Email string `json:"email"`
	City  string `json:"city"`
}

// Create the table component for Person data
var PersonTable = ui.MakeTableComponent[Person]("PersonTable")

// Sample data exposed as DataAtom for external system access
var sampleData = app.DataAtom("sampleData", []Person{
	{Name: "Alice Johnson", Age: 28, Email: "alice@example.com", City: "New York"},
	{Name: "Bob Smith", Age: 34, Email: "bob@example.com", City: "Los Angeles"},
	{Name: "Carol Davis", Age: 22, Email: "carol@example.com", City: "Chicago"},
	{Name: "David Wilson", Age: 41, Email: "david@example.com", City: "Houston"},
	{Name: "Eve Brown", Age: 29, Email: "eve@example.com", City: "Phoenix"},
	{Name: "Frank Miller", Age: 37, Email: "frank@example.com", City: "Philadelphia"},
	{Name: "Grace Lee", Age: 25, Email: "grace@example.com", City: "San Antonio"},
	{Name: "Henry Taylor", Age: 33, Email: "henry@example.com", City: "San Diego"},
	{Name: "Ivy Chen", Age: 26, Email: "ivy@example.com", City: "Dallas"},
	{Name: "Jack Anderson", Age: 31, Email: "jack@example.com", City: "San Jose"},
}, &app.AtomMeta{
	Desc: "Sample person data for table display testing",
})

// The App component is the required entry point for every Tsunami application
var App = app.DefineComponent("App", func(_ struct{}) any {
	app.UseSetAppTitle("Table Test Demo")

	// Define table columns
	columns := []ui.TableColumn[Person]{
		{
			AccessorKey: "Name",
			Header:      "Full Name",
			Sortable:    true,
			Width:       "200px",
		},
		{
			AccessorKey: "Age", 
			Header:      "Age",
			Sortable:    true,
			Width:       "80px",
		},
		{
			AccessorKey: "Email",
			Header:      "Email Address", 
			Sortable:    true,
			Width:       "250px",
		},
		{
			AccessorKey: "City",
			Header:      "City",
			Sortable:    true,
			Width:       "150px",
		},
	}

	// Handle row clicks
	handleRowClick := func(person Person, idx int) {
		fmt.Printf("Clicked on row %d: %s from %s\n", idx, person.Name, person.City)
	}

	// Handle sorting
	handleSort := func(column string, direction string) {
		fmt.Printf("Sorting by %s in %s order\n", column, direction)
	}

	return vdom.H("div", map[string]any{
		"className": "max-w-6xl mx-auto p-6 space-y-6",
	},
		vdom.H("div", map[string]any{
			"className": "text-center",
		},
			vdom.H("h1", map[string]any{
				"className": "text-3xl font-bold text-white mb-2",
			}, "Table Component Demo"),
			vdom.H("p", map[string]any{
				"className": "text-gray-300",
			}, "Testing the Tsunami table component with sample data"),
		),

		vdom.H("div", map[string]any{
			"className": "bg-gray-800 p-4 rounded-lg",
		},
			PersonTable(ui.TableProps[Person]{
				Data:        sampleData.Get(),
				Columns:     columns,
				OnRowClick:  handleRowClick,
				OnSort:      handleSort,
				DefaultSort: "Name",
				Selectable:  true,
				Pagination: &ui.PaginationConfig{
					PageSize:    5,
					CurrentPage: 0,
					ShowSizes:   []int{5, 10, 25},
				},
			}),
		),

		vdom.H("div", map[string]any{
			"className": "text-center text-gray-400 text-sm",
		}, "Click on rows to see interactions. Try sorting by clicking column headers."),
	)
})